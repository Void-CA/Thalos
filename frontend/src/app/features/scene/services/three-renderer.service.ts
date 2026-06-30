import { Injectable, NgZone, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneOverlay } from '../renderer/scene-overlay.interface';
import { DEFAULT_FRAME_STYLE, ObjectTransform, SceneData, SceneFrame, SceneLink, ScenePrimitive } from '../scene.types';

interface FrameSlot {
  group: THREE.Group;
}

interface LinkSlot {
  mesh: THREE.Mesh;
  baseLen: number;
}

interface PrimitiveSlot {
  mesh: THREE.Mesh;
}

@Injectable({ providedIn: 'root' })
export class ThreeRendererService {
  private readonly ngZone = inject(NgZone);

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private contentGroup: THREE.Group | null = null;
  private targetGroup: THREE.Group | null = null;
  private compassGroup: THREE.Group | null = null;
  private frameId: number | null = null;
  private readonly overlays = new Set<SceneOverlay>();

  // ── Scene content caches (id → slot) ──
  private frameSlots = new Map<string, FrameSlot>();
  private linkSlots = new Map<string, LinkSlot>();
  private primitiveSlots = new Map<string, PrimitiveSlot>();

  /**
   * Registro genérico de Object3D indexados por ID.
   *
   * Durante `syncTransforms`, cada `TransformUpdate` busca su Object3D aquí
   * y actualiza position/quaternion/scale sin importar si es un frame, un
   * link o una primitive.
   *
   * Los objetos se registran durante `applyScene` y se eliminan al disponerlos.
   */
  private readonly objectRegistry = new Map<string, THREE.Object3D>();

  // ── Reusable scratch objects (avoid allocations in hot path) ──
  private readonly scratchVec = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchDir = new THREE.Vector3();
  // CylinderGeometry is Y-aligned — this is a mesh adapter reference, NOT a
  // coordinate system setting. Three.js CylinderGeometry stays Y-aligned while
  // canonical Thalos cylinders are Z-aligned (mesh adapter, per ADR-0001).
  private readonly linkUp = new THREE.Vector3(0, 1, 0);

  // ── Material cache (per-color dedup) ──
  private readonly matCache = new Map<number, THREE.Material>();

  // ── Public API ──

  init(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(2, -3, 2);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h, false);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(2, 5, 3);
    this.scene.add(sun);

    // Reference grid (XY plane — Z-up horizontal ground)
    const grid = new THREE.GridHelper(4, 10, 0x666666, 0x444444);
    grid.rotation.x = Math.PI / 2;  // default XZ → XY for Z-up
    this.scene.add(grid);

    // Content container
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);

    // IK target gizmo — hidden by default
    this.targetGroup = new THREE.Group();
    this.buildTargetGizmo(this.targetGroup);
    this.targetGroup.visible = false;
    this.scene.add(this.targetGroup);

    // ── Compass (child of camera — always visible) ──
    this.compassGroup = new THREE.Group();
    this.buildCompassAxes(this.compassGroup, 0.35);
    this.compassGroup.position.set(-0.55, -0.4, -0.9);
    this.camera.add(this.compassGroup);

    // Resize
    window.addEventListener('resize', this.onResize);

    for (const overlay of this.overlays) {
      overlay.attach(this.scene);
    }

    // rAF loop — runs outside Angular zone to avoid unnecessary CD
    this.ngZone.runOutsideAngular(() => this.startLoop());
  }

  /** Register an overlay so it can attach to the renderer scene. */
  registerOverlay(overlay: SceneOverlay): void {
    if (this.overlays.has(overlay)) return;
    this.overlays.add(overlay);

    if (this.scene) {
      overlay.attach(this.scene);
    }
  }

  applyScene(scene: SceneData): void {
    if (!this.contentGroup) return;

    this.syncFrames(scene.frames);
    this.syncLinks(scene.links);
    this.syncPrimitives(scene.primitives);
  }

  private syncFrames(frames: SceneFrame[]): void {
    const incoming = new Set<string>();

    for (const frame of frames) {
      incoming.add(frame.id);
      let slot = this.frameSlots.get(frame.id);
      if (!slot) {
        slot = { group: this.buildFrame(frame) };
        this.frameSlots.set(frame.id, slot);
        this.contentGroup!.add(slot.group);
        this.objectRegistry.set(frame.id, slot.group);
      }
      // Update transform only — no geometry churn
      const g = slot.group;
      g.position.set(frame.translation[0], frame.translation[1], frame.translation[2]);
      // Rust: [w, x, y, z] → Three.js: (x, y, z, w)
      g.quaternion.set(
        frame.rotation[1],
        frame.rotation[2],
        frame.rotation[3],
        frame.rotation[0],
      );
    }

    // Dispose removed frames
    for (const [id, slot] of this.frameSlots) {
      if (!incoming.has(id)) {
        this.contentGroup!.remove(slot.group);
        this.disposeGroup(slot.group);
        this.objectRegistry.delete(id);
        this.frameSlots.delete(id);
      }
    }
  }

  private buildFrame(frame: SceneFrame): THREE.Group {
    const g = new THREE.Group();
    const style = frame.style ?? DEFAULT_FRAME_STYLE;

    if (style.originRadius > 0) {
      g.add(new THREE.Mesh(
        new THREE.SphereGeometry(style.originRadius, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xcccccc }),
      ));
    }

    this.makeAxisArrow(g, style.axisLength, style.axisRadius, style.colorX, new THREE.Vector3(1, 0, 0));
    this.makeAxisArrow(g, style.axisLength, style.axisRadius, style.colorY, new THREE.Vector3(0, 1, 0));
    this.makeAxisArrow(g, style.axisLength, style.axisRadius, style.colorZ, new THREE.Vector3(0, 0, 1));

    return g;
  }

  /**
   * Actualización genérica de transforms desde RuntimeDelta.
   *
   * Cada `TransformUpdate` contiene un `id` que corresponde a un Object3D
   * registrado durante `applyScene`. El método simplemente aplica
   * position + quaternion + scale — sin importar si el objeto es un frame,
   * un link o una primitive.
   */
  syncTransforms(transforms: ObjectTransform[]): void {
    for (const tx of transforms) {
      const obj = this.objectRegistry.get(tx.id);
      if (!obj) continue;
      obj.position.set(tx.translation[0], tx.translation[1], tx.translation[2]);
      obj.quaternion.set(tx.rotation[1], tx.rotation[2], tx.rotation[3], tx.rotation[0]);
      obj.scale.set(tx.scale[0], tx.scale[1], tx.scale[2]);
    }
  }

  private syncLinks(links: SceneLink[]): void {
    // Tracks links actually present in the scene (visible cylinders). A link
    // with zero length is skipped and does NOT count as live — its previous
    // slot, if any, is disposed below. This is the key invariant that
    // prevents ghost meshes when switching between robots with different
    // joint topologies (e.g. 3DOF → SCARA, where some segments have
    // identity transforms and produce start == end).
    const rendered = new Set<string>();

    for (const link of links) {
      // Use the link's structural id (joint id of the source segment) as
      // the reconciliation key. Stable across robot swaps — switching from
      // a 3DOF to a SCARA will never reuse a key from the previous chain.
      const key = link.id;

      this.scratchDir
        .set(link.end[0] - link.start[0], link.end[1] - link.start[1], link.end[2] - link.start[2]);
      const len = this.scratchDir.length();
      if (len < 1e-10) continue;

      let slot = this.linkSlots.get(key);
      if (!slot) {
        // Build a unit cylinder along +Y; we'll scale Y to actual length.
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.018, 1, 8, 1),
          new THREE.MeshStandardMaterial({ color: 0x3399ff }),
        );
        slot = { mesh, baseLen: 1 };
        this.linkSlots.set(key, slot);
        this.contentGroup!.add(mesh);
        this.objectRegistry.set(key, mesh);
      }

      const mesh = slot.mesh;
      // Midpoint
      mesh.position.set(
        (link.start[0] + link.end[0]) * 0.5,
        (link.start[1] + link.end[1]) * 0.5,
        (link.start[2] + link.end[2]) * 0.5,
      );
      // Orient +Y → direction, scale Y to length
      this.scratchVec.copy(this.scratchDir).normalize();
      mesh.quaternion.setFromUnitVectors(this.linkUp, this.scratchVec);
      mesh.scale.set(1, len, 1);

      // Mark as rendered only after the slot exists and was updated.
      rendered.add(key);
    }

    // Dispose links that are no longer rendered. A slot survives only if
    // its key was rendered this frame — zero-length links and links that
    // disappeared from the snapshot are both disposed uniformly.
    for (const [key, slot] of this.linkSlots) {
      if (!rendered.has(key)) {
        this.contentGroup!.remove(slot.mesh);
        slot.mesh.geometry.dispose();
        (slot.mesh.material as THREE.Material).dispose();
        this.objectRegistry.delete(key);
        this.linkSlots.delete(key);
      }
    }
  }

  private syncPrimitives(primitives: ScenePrimitive[]): void {
    const incoming = new Set<string>();

    for (const p of primitives) {
      incoming.add(p.id);
      let slot = this.primitiveSlots.get(p.id);

      const color = p.color ? this.rgbaToColor(p.color) : this.colorFor(p.id);

      // Resolve parent: frame group if known, else contentGroup.
      // Guard: applyScene already checked this.contentGroup before calling syncPrimitives.
      const fallback = this.contentGroup!; // non-null: guarded by applyScene
      const parentGroup = this.frameSlots.get(p.frameId)?.group ?? fallback;

      if (!slot) {
        const geo = this.buildPrimitiveGeometry(p.geometry);
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, this.getMaterial(color));
        slot = { mesh };
        this.primitiveSlots.set(p.id, slot);
        parentGroup.add(mesh);
        this.objectRegistry.set(p.id, mesh);
      } else if (slot.mesh.parent !== parentGroup) {
        // Reparent if frame changed (rare — robot swap)
        slot.mesh.parent?.remove(slot.mesh);
        parentGroup.add(slot.mesh);
      }

      // Local position/rotation relative to parent frame (or world)
      slot.mesh.position.set(p.translation[0], p.translation[1], p.translation[2]);
      slot.mesh.quaternion.set(
        p.rotation[1],
        p.rotation[2],
        p.rotation[3],
        p.rotation[0],
      );
    }

    // Dispose removed primitives
    for (const [id, slot] of this.primitiveSlots) {
      if (!incoming.has(id)) {
        slot.mesh.parent?.remove(slot.mesh);
        slot.mesh.geometry.dispose();
        this.objectRegistry.delete(id);
        this.primitiveSlots.delete(id);
      }
    }
  }

  /** Convert RGBA (0..1) from URDF to a hex number usable by Three.js. */
  private rgbaToColor([r, g, b, _a]: [number, number, number, number]): number {
    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  }

  /** Fallback colour when the backend didn't provide one. */
  private colorFor(id: string): number {
    if (id.includes('column')) return 0x888888;
    if (id.includes('link_1')) return 0x3399ff;
    if (id.includes('link_2')) return 0x44bbaa;
    return 0xaaaaaa;
  }

  private getMaterial(color: number): THREE.Material {
    let mat = this.matCache.get(color);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color });
      this.matCache.set(color, mat);
    }
    return mat;
  }

  private buildPrimitiveGeometry(g: ScenePrimitive['geometry']): THREE.BufferGeometry | null {
    switch (g.type) {
      case 'cylinder':
        return new THREE.CylinderGeometry(g.radius, g.radius, g.height, 16, 1);
      case 'sphere':
        return new THREE.SphereGeometry(g.radius, 16, 16);
      case 'box':
        return new THREE.BoxGeometry(g.width, g.height, g.depth);
    }
  }

  /** Construye un eje visual: flecha cilíndrica si radius>0, línea si radius≈0. */
  private makeAxisArrow(
    parent: THREE.Group,
    length: number,
    radius: number,
    rgb: [number, number, number],
    dir: THREE.Vector3,
  ): void {
    const color = new THREE.Color(rgb[0], rgb[1], rgb[2]);
    const headLen = Math.min(length * 0.2, 0.04);
    const shaftLen = length - headLen;
    const up = new THREE.Vector3(0, 1, 0);

    const shaftCenter = dir.clone().multiplyScalar(shaftLen / 2);
    const headCenter = dir.clone().multiplyScalar(shaftLen + headLen / 2);

    if (radius > 1e-6) {
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, shaftLen, 6, 1),
        new THREE.MeshStandardMaterial({ color }),
      );
      shaft.position.copy(shaftCenter);
      shaft.quaternion.setFromUnitVectors(up, dir);
      parent.add(shaft);

      const head = new THREE.Mesh(
        new THREE.ConeGeometry(radius * 3, headLen, 6, 1),
        new THREE.MeshStandardMaterial({ color }),
      );
      head.position.copy(headCenter);
      head.quaternion.setFromUnitVectors(up, dir);
      parent.add(head);
    } else {
      const pts = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(length)];
      parent.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color }),
      ));
    }
  }

  /** Construye los ejes de la brújula (estilo fijo, siempre visible). */
  private buildCompassAxes(parent: THREE.Group, size: number): void {
    const headFrac = 0.18;
    const shaftLen = size * (1 - headFrac);
    const headLen = size * headFrac;
    const r = size * 0.025;

    const build = (rgb: [number, number, number], dir: THREE.Vector3): void => {
      const color = new THREE.Color(rgb[0], rgb[1], rgb[2]);
      const up = new THREE.Vector3(0, 1, 0);

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, shaftLen, 6, 1),
        new THREE.MeshStandardMaterial({ color }),
      );
      shaft.position.y = shaftLen / 2;
      shaft.quaternion.setFromUnitVectors(up, dir);
      parent.add(shaft);

      const head = new THREE.Mesh(
        new THREE.ConeGeometry(r * 3, headLen, 6, 1),
        new THREE.MeshStandardMaterial({ color }),
      );
      head.position.y = shaftLen + headLen / 2;
      head.quaternion.setFromUnitVectors(up, dir);
      parent.add(head);
    };

    build([1.0, 0.5, 0.0], new THREE.Vector3(1, 0, 0));
    build([0.0, 0.8, 0.0], new THREE.Vector3(0, 1, 0));
    build([0.0, 0.5, 1.0], new THREE.Vector3(0, 0, 1));
  }

  /** Build the IK target gizmo (glowing sphere + ring + local axes). */
  private buildTargetGizmo(grp: THREE.Group): void {
    // Glowing sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 }),
    );
    grp.add(sphere);

    // Ring orbit — RingGeometry defaults to XY plane (horizontal in Z-up)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.08, 32),
      new THREE.MeshBasicMaterial({ color: 0xff6600, side: THREE.DoubleSide, transparent: true, opacity: 0.4 }),
    );
    grp.add(ring);

    // Small local axes
    const len = 0.06;
    const r = 0.003;
    const matX = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    const matY = new THREE.MeshBasicMaterial({ color: 0x44ff00 });
    const matZ = new THREE.MeshBasicMaterial({ color: 0x0088ff });
    const up = new THREE.Vector3(0, 1, 0);

    const makeAxis = (mat: THREE.Material, dir: THREE.Vector3): void => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1), mat);
      mesh.position.copy(dir.clone().multiplyScalar(len / 2));
      mesh.quaternion.setFromUnitVectors(up, dir);
      grp.add(mesh);
    };

    makeAxis(matX, new THREE.Vector3(1, 0, 0));
    makeAxis(matY, new THREE.Vector3(0, 1, 0));
    makeAxis(matZ, new THREE.Vector3(0, 0, 1));
  }

  /** Show the IK target gizmo at the given world position/orientation. */
  setTarget(position: [number, number, number], quaternion?: [number, number, number, number]): void {
    if (!this.targetGroup) return;
    this.targetGroup.position.set(position[0], position[1], position[2]);
    if (quaternion) {
      this.targetGroup.quaternion.set(quaternion[1], quaternion[2], quaternion[3], quaternion[0]);
    } else {
      this.targetGroup.quaternion.identity();
    }
    this.targetGroup.visible = true;
  }

  /** Hide the IK target gizmo. */
  clearTarget(): void {
    if (this.targetGroup) {
      this.targetGroup.visible = false;
    }
  }

  dispose(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    window.removeEventListener('resize', this.onResize);
    this.controls?.dispose();
    this.renderer?.dispose();

    // Dispose all cached scene content
    for (const slot of this.frameSlots.values()) {
      this.disposeGroup(slot.group);
    }
    this.frameSlots.clear();

    for (const slot of this.linkSlots.values()) {
      slot.mesh.geometry.dispose();
      (slot.mesh.material as THREE.Material).dispose();
    }
    this.linkSlots.clear();

    for (const slot of this.primitiveSlots.values()) {
      slot.mesh.geometry.dispose();
    }
    this.primitiveSlots.clear();

    for (const mat of this.matCache.values()) {
      mat.dispose();
    }
    this.matCache.clear();

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.contentGroup = null;
  }

  /**
   * Frame the robot in the viewport by positioning the camera and orbit
   * target so the union of all links and primitives fills ~80 % of the view.
   */
  fitToView(data: SceneData): void {
    const camera = this.camera;
    const controls = this.controls;
    if (!camera || !controls) return;

    const box = new THREE.Box3();

    // Expand with link endpoints
    for (const link of data.links) {
      box.expandByPoint(new THREE.Vector3(link.start[0], link.start[1], link.start[2]));
      box.expandByPoint(new THREE.Vector3(link.end[0], link.end[1], link.end[2]));
    }

    // Expand with primitive positions + geometry extents
    const tmp = new THREE.Vector3();
    for (const p of data.primitives) {
      const t = p.translation;
      const center = new THREE.Vector3(t[0], t[1], t[2]);
      const g = p.geometry;
      const half = (() => {
        switch (g.type) {
          case 'box': return Math.max(g.width, g.height, g.depth) / 2;
          case 'sphere': return g.radius;
          case 'cylinder': return Math.max(g.radius * 2, g.height) / 2;
        }
      })();
      box.expandByPoint(center);
      tmp.copy(center).addScalar(half);
      box.expandByPoint(tmp);
      tmp.copy(center).addScalar(-half);
      box.expandByPoint(tmp);
    }

    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);

    const vFov = camera.fov * Math.PI / 180;
    const dist = (maxDim / 2) / Math.tan(vFov / 2) * 1.4;

    const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    const len = dir.length();
    if (len > 1e-10) {
      dir.normalize();
      camera.position.copy(center).add(dir.multiplyScalar(dist));
    } else {
      camera.position.set(center.x, center.y, center.z + dist);
    }

    controls.target.copy(center);
    controls.update();
  }

  // ── Private ──

  private startLoop(): void {
    const loop = (): void => {
      this.frameId = requestAnimationFrame(loop);
      this.controls?.update();

      const cam = this.camera;
      if (!cam || !this.renderer || !this.scene) return;

      // Counter-rotate the compass so it always points in global directions
      if (this.compassGroup) {
        this.compassGroup.quaternion.copy(cam.quaternion).invert();
      }

      this.renderer.render(this.scene, cam);
    };
    loop();
  }

  private onResize = (): void => {
    const r = this.renderer;
    const c = this.camera;
    if (!r || !c) return;
    const el = r.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    r.setSize(w, h, false);
    c.aspect = w / h;
    c.updateProjectionMatrix();
  };

  /** Recursively dispose geometries and materials of all children. */
  private disposeGroup(group: THREE.Group): void {
    group.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose());
        } else {
          mat.dispose();
        }
      }
    });
  }
}
