import { Injectable, NgZone, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_FRAME_STYLE, SceneData, ScenePrimitive } from '../scene.types';


@Injectable({ providedIn: 'root' })
export class ThreeRendererService {
  private readonly ngZone = inject(NgZone);

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private contentGroup: THREE.Group | null = null;
  private compassGroup: THREE.Group | null = null;
  private frameId: number | null = null;

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

    // Content container — cleared on every applyScene
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);

    // ── Compass (hijo de la cámara — siempre visible en pantalla) ──
    this.compassGroup = new THREE.Group();
    this.buildCompassAxes(this.compassGroup, 0.35);
    // Posición relativa a la cámara: abajo‑izquierda, ligeramente adelante
    this.compassGroup.position.set(-0.55, -0.4, -0.9);
    this.camera.add(this.compassGroup);

    // Resize
    this.bindResize();
    window.addEventListener('resize', this.onResize);

    // rAF loop — runs outside Angular zone to avoid unnecessary CD
    this.ngZone.runOutsideAngular(() => this.startLoop());
  }

  applyScene(scene: SceneData): void {
    const grp = this.contentGroup;
    if (!grp || !this.scene) return;

    // Fast clear — let GC collect old objects
    grp.clear();

    // ── Frames ──
    for (const frame of scene.frames) {
      const g = new THREE.Group();
      g.position.set(frame.translation[0], frame.translation[1], frame.translation[2]);
      // Rust: [w, x, y, z] → Three.js: (x, y, z, w)
      g.quaternion.set(frame.rotation[1], frame.rotation[2], frame.rotation[3], frame.rotation[0]);

      const style = frame.style ?? DEFAULT_FRAME_STYLE;

      // Origin sphere
      if (style.originRadius > 0) {
        g.add(new THREE.Mesh(
          new THREE.SphereGeometry(style.originRadius, 12, 12),
          new THREE.MeshStandardMaterial({ color: 0xcccccc }),
        ));
      }

      // Three axes with styled arrows
      this.makeAxisArrow(g, style.axisLength, style.axisRadius, style.colorX, new THREE.Vector3(1, 0, 0));
      this.makeAxisArrow(g, style.axisLength, style.axisRadius, style.colorY, new THREE.Vector3(0, 1, 0));
      this.makeAxisArrow(g, style.axisLength, style.axisRadius, style.colorZ, new THREE.Vector3(0, 0, 1));

      grp.add(g);
    }

    // ── Links ──
    const linkUp = new THREE.Vector3(0, 1, 0);
    for (const link of scene.links) {
      const start = new THREE.Vector3(link.start[0], link.start[1], link.start[2]);
      const end = new THREE.Vector3(link.end[0], link.end[1], link.end[2]);
      const dir = new THREE.Vector3().copy(end).sub(start);
      const len = dir.length();
      if (len < 1e-10) continue;

      const mid = new THREE.Vector3().copy(start).add(end).multiplyScalar(0.5);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, len, 8, 1),
        new THREE.MeshStandardMaterial({ color: 0x3399ff }),
      );
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(linkUp, dir.clone().normalize());
      grp.add(mesh);
    }

    // ── Joint axes (omitido — la flecha Z de cada frame ya indica el eje) ──

    // ── Primitives ──
    this.renderPrimitives(grp, scene);

    // ── Twists (not yet populated by backend — placeholder) ──
    // Future: render linear angular arrows from each twist
  }

  private renderPrimitives(grp: THREE.Group, scene: SceneData): void {
    const matCache = new Map<string, THREE.Material>();

    function getMat(color: number): THREE.Material {
      const key = color.toString(16);
      if (!matCache.has(key)) {
        matCache.set(key, new THREE.MeshStandardMaterial({ color }));
      }
      return matCache.get(key)!;
    }

    for (const p of scene.primitives) {
      const pos = new THREE.Vector3(p.translation[0], p.translation[1], p.translation[2]);
      // Rust quaternion [w, x, y, z] → Three.js (x, y, z, w)
      const rot = new THREE.Quaternion(p.rotation[1], p.rotation[2], p.rotation[3], p.rotation[0]);

      const geo = this.buildPrimitiveGeometry(p.geometry);
      if (!geo) continue;

      // Color por id para distinguir visualmente
      const color = p.id.includes('column') ? 0x888888
                 : p.id.includes('link_1') ? 0x3399ff
                 : p.id.includes('link_2') ? 0x44bbaa
                 : 0xaaaaaa;

      const mesh = new THREE.Mesh(geo, getMat(color));
      mesh.position.copy(pos);
      mesh.quaternion.copy(rot);
      grp.add(mesh);
    }
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

    // Position along dir (not parent Y) so axes don't cross
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

  dispose(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    window.removeEventListener('resize', this.onResize);
    this.controls?.dispose();
    this.renderer?.dispose();

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.contentGroup = null;
  }

  // ── Private ──

  private startLoop(): void {
    const invQuat = new THREE.Quaternion();
    const loop = (): void => {
      this.frameId = requestAnimationFrame(loop);
      this.controls?.update();

      const cam = this.camera;
      if (!cam || !this.renderer || !this.scene) return;

      // Contra‑rotar el compass para que siempre apunte en direcciones globales
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

  private bindResize = (): void => {
    // bound once; used for both addEventListener / removeEventListener reference
  };
}
