import { Injectable, NgZone, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_FRAME_STYLE, SceneData, SceneFrame, SceneLink, ScenePrimitive } from '../scene.types';

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
  private workspaceGroup: THREE.Group | null = null;
  private pointCloudMesh: THREE.Points | null = null;
  private frameId: number | null = null;

  // ── Scene content caches (id → slot) ──
  private frameSlots = new Map<string, FrameSlot>();
  private linkSlots = new Map<string, LinkSlot>();
  private primitiveSlots = new Map<string, PrimitiveSlot>();

  // ── Reusable scratch objects (avoid allocations in hot path) ──
  private readonly scratchVec = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchDir = new THREE.Vector3();
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
    this.camera.position.set(0, 0, 3);

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

    // Reference grid (XZ plane — robot lives in XY)
    this.scene.add(new THREE.GridHelper(4, 10, 0x666666, 0x444444));

    // Content container
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);

    // Workspace overlay (point cloud, AABB) — renders ON TOP of the robot
    this.workspaceGroup = new THREE.Group();
    this.scene.add(this.workspaceGroup);

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

    // rAF loop — runs outside Angular zone to avoid unnecessary CD
    this.ngZone.runOutsideAngular(() => this.startLoop());
  }

  /**
   * Apply a scene snapshot. Diffs against cached slots and only updates
   * transforms / creates new objects when needed.
   *
   *  - Frames / links / primitives keyed by `id` are reused.
   *  - Removed ids have their slots disposed.
   *  - New ids have their meshes built once.
   */
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
        this.linkSlots.delete(key);
      }
    }
  }

  private syncPrimitives(primitives: ScenePrimitive[]): void {
    const incoming = new Set<string>();

    for (const p of primitives) {
      incoming.add(p.id);
      let slot = this.primitiveSlots.get(p.id);

      const color = this.colorFor(p.id);

      if (!slot) {
        const geo = this.buildPrimitiveGeometry(p.geometry);
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, this.getMaterial(color));
        slot = { mesh };
        this.primitiveSlots.set(p.id, slot);
        this.contentGroup!.add(mesh);
      }

      slot.mesh.position.set(p.translation[0], p.translation[1], p.translation[2]);
      // Rust quaternion [w, x, y, z] → Three.js (x, y, z, w)
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
        this.contentGroup!.remove(slot.mesh);
        slot.mesh.geometry.dispose();
        this.primitiveSlots.delete(id);
      }
    }
  }

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

    // Ring orbit
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.08, 32),
      new THREE.MeshBasicMaterial({ color: 0xff6600, side: THREE.DoubleSide, transparent: true, opacity: 0.4 }),
    );
    ring.rotation.x = Math.PI / 2;
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

  // ── Point cloud (workspace overlay) ──

  /** Render sampled workspace points in the 3D scene (monochrome). */
  setPointCloud(positions: [number, number, number][]): void {
    this.clearPointCloud();
    if (!this.workspaceGroup) return;

    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i++) {
      vertices[i * 3]     = positions[i][0];
      vertices[i * 3 + 1] = positions[i][1];
      vertices[i * 3 + 2] = positions[i][2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xff8800,
      size: 0.015,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.pointCloudMesh = new THREE.Points(geo, mat);
    this.pointCloudMesh.frustumCulled = true;

    this.workspaceGroup.add(this.pointCloudMesh);
    this.workspaceGroup.visible = true;
  }

  /** Render colored workspace points based on singularity state. */
  setColoredPointCloud(points: { position: [number, number, number]; state: 'normal' | 'near_singular' | 'singular' }[]): void {
    this.clearPointCloud();
    if (!this.workspaceGroup) return;

    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      vertices[i * 3]     = p.position[0];
      vertices[i * 3 + 1] = p.position[1];
      vertices[i * 3 + 2] = p.position[2];

      // Green = normal, Yellow = near_singular, Red = singular
      let r: number, g: number, b: number;
      switch (p.state) {
        case 'normal':
          r = 0.2; g = 0.9; b = 0.2; break;
        case 'near_singular':
          r = 0.9; g = 0.8; b = 0.1; break;
        case 'singular':
          r = 0.9; g = 0.1; b = 0.1; break;
      }
      colors[i * 3]     = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.015,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      depthWrite: false,
      vertexColors: true,
    });

    this.pointCloudMesh = new THREE.Points(geo, mat);
    this.pointCloudMesh.frustumCulled = true;

    this.workspaceGroup.add(this.pointCloudMesh);
    this.workspaceGroup.visible = true;
  }

  /** Remove the point cloud overlay from the scene. */
  clearPointCloud(): void {
    if (this.pointCloudMesh) {
      this.workspaceGroup?.remove(this.pointCloudMesh);
      this.pointCloudMesh.geometry.dispose();
      (this.pointCloudMesh.material as THREE.Material).dispose();
      this.pointCloudMesh = null;
    }
    if (this.workspaceGroup) {
      this.workspaceGroup.visible = false;
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

    // Dispose workspace overlay
    if (this.workspaceGroup) {
      this.disposeGroup(this.workspaceGroup);
      this.scene?.remove(this.workspaceGroup);
    }
    this.pointCloudMesh = null;
    this.workspaceGroup = null;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.contentGroup = null;
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
