import { AfterViewInit, Component, effect, ElementRef, inject, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WorkspaceStore } from '../../store/workspace.store';

/**
 * Three.js renderer for workspace point cloud + AABB wireframe.
 *
 * Re-renders when WorkspaceStore.data changes via Angular effect().
 * Uses a separate canvas from the scene viewer.
 */
@Component({
  selector: 'workspace-renderer',
  standalone: true,
  template: `<canvas #canvas></canvas>`,
  styles: [`canvas { display: block; width: 100%; height: 200px; }`],
})
export class WorkspaceRenderer implements AfterViewInit {
  @ViewChild('canvas') private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly store = inject(WorkspaceStore);

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private contentGroup: THREE.Group | null = null;
  private frameId: number | null = null;

  ngAfterViewInit(): void {
    this.init();
    this.animate();

    // React to workspace data changes
    effect(() => {
      const data = this.store.data();
      if (data) {
        this.buildWorkspaceScene(data);
      } else {
        this.clearScene();
      }
    });
  }

  private init(): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.parentElement?.getBoundingClientRect();
    const w = rect?.width ?? 400;
    const h = rect?.height ?? 200;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    this.camera.position.set(2, 1, 3);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h, false);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(2, 5, 3);
    this.scene.add(sun);

    // Grid
    this.scene.add(new THREE.GridHelper(4, 10, 0x666666, 0x444444));

    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);
  }

  private buildWorkspaceScene(data: { bounds: { min: [number, number, number]; max: [number, number, number] } }): void {
    this.clearScene();
    if (!this.contentGroup) return;

    const g = this.contentGroup;
    const { min, max } = data.bounds;

    // ── AABB Wireframe ──
    const boxGeo = new THREE.BoxGeometry(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    );
    const boxMat = new THREE.LineBasicMaterial({ color: 0x4a90d9 });
    const wireframe = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), boxMat);
    wireframe.position.set(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    );
    g.add(wireframe);

    // ── Point cloud (shown as small dots) ──
    // If we had samples, we'd render them. For now the wireframe suffices.
    // The store doesn't expose individual points (include_samples is false by default).
  }

  private clearScene(): void {
    if (!this.contentGroup) return;
    while (this.contentGroup.children.length > 0) {
      const child = this.contentGroup.children[0];
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      this.contentGroup.remove(child);
    }
  }

  private animate(): void {
    this.frameId = requestAnimationFrame(() => this.animate());
    this.controls?.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
