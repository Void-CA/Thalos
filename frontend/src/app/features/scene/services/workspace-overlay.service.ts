import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({ providedIn: 'root' })
export class WorkspaceOverlayService {
  private group: THREE.Group | null = null;
  private pointCloudMesh: THREE.Points | null = null;

  /**
   * Attach this overlay to a Three.js scene.
   * Must be called once after the renderer is initialized.
   */
  attach(scene: THREE.Scene): void {
    if (this.group) return; // already attached
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // ── Point cloud methods ──

  /** Monochrome point cloud (default orange). */
  setPointCloud(positions: [number, number, number][]): void {
    this.clear();
    if (!this.group) return;

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
    this.group.add(this.pointCloudMesh);
    this.group.visible = true;
  }

  /**
   * Gradient point cloud from a normalized value [0, 1].
   * Green (1.0) → Yellow (0.5) → Red (0.0).
   */
  setGradientPointCloud(
    points: { position: [number, number, number]; normalized: number }[],
  ): void {
    this.clear();
    if (!this.group) return;

    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      vertices[i * 3]     = p.position[0];
      vertices[i * 3 + 1] = p.position[1];
      vertices[i * 3 + 2] = p.position[2];

      const t = Math.max(0, Math.min(1, p.normalized));
      let r: number, g: number;
      if (t > 0.5) {
        const u = (t - 0.5) * 2;
        r = 0.9 - u * 0.7;
        g = 0.8 + u * 0.1;
      } else {
        const u = t * 2;
        r = 0.9;
        g = 0.1 + u * 0.7;
      }
      colors[i * 3]     = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = 0.1;
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
    this.group.add(this.pointCloudMesh);
    this.group.visible = true;
  }

  /** Colored point cloud based on singularly state. */
  setColoredPointCloud(
    points: { position: [number, number, number]; state: 'normal' | 'near_singular' | 'singular' }[],
  ): void {
    this.clear();
    if (!this.group) return;

    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      vertices[i * 3]     = p.position[0];
      vertices[i * 3 + 1] = p.position[1];
      vertices[i * 3 + 2] = p.position[2];

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
    this.group.add(this.pointCloudMesh);
    this.group.visible = true;
  }

  /** Hide the current point cloud without disposing resources. */
  hide(): void {
    if (this.group) {
      this.group.visible = false;
    }
  }

  /** Clear the current point cloud and dispose GPU resources. */
  clear(): void {
    if (this.pointCloudMesh) {
      this.group?.remove(this.pointCloudMesh);
      this.pointCloudMesh.geometry.dispose();
      (this.pointCloudMesh.material as THREE.Material).dispose();
      this.pointCloudMesh = null;
    }
    if (this.group) {
      this.group.visible = false;
    }
  }

  /** Full cleanup — dispose all resources owned by this overlay. */
  dispose(): void {
    this.clear();
    if (this.group) {
      this.group.traverse(obj => {
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
      const parent = this.group.parent;
      parent?.remove(this.group);
    }
    this.group = null;
  }
}
