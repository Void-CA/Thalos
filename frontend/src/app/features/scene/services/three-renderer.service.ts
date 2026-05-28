import { Injectable, NgZone, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneData } from '../scene.types';


@Injectable({ providedIn: 'root' })
export class ThreeRendererService {
  private readonly ngZone = inject(NgZone);

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private contentGroup: THREE.Group | null = null;
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

      // Origin marker
      g.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa }),
      ));

      // Coordinate axes
      g.add(new THREE.AxesHelper(0.12));

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

    // ── Joint axes ──
    for (const ja of scene.jointAxes) {
      const origin = new THREE.Vector3(ja.origin[0], ja.origin[1], ja.origin[2]);
      const axis = new THREE.Vector3(ja.axis[0], ja.axis[1], ja.axis[2]).normalize();
      const half = 0.18;

      const pts = [
        origin.clone().add(axis.clone().multiplyScalar(-half)),
        origin.clone().add(axis.clone().multiplyScalar(half)),
      ];
      grp.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff8800 }),
      ));
    }

    // ── Twists (not yet populated by backend — placeholder) ──
    // Future: render linear angular arrows from each twist
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
    const loop = (): void => {
      this.frameId = requestAnimationFrame(loop);
      this.controls?.update();
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
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
