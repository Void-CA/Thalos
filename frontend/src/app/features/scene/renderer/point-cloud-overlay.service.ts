import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SceneOverlay } from './scene-overlay.interface';

/**
 * Overlay que renderiza tres capas independientes de nubes de puntos
 * sobre la escena robótica:
 *  - Base cloud (monocromo naranja)
 *  - Manipulabilidad (gradiente verde → rojo según Yoshikawa)
 *  - Singularidad (colores por estado: normal / near_singular / singular)
 *
 * Cada capa tiene su propio mesh y visibilidad independiente,
 * permitiendo mostrar varias capas simultáneamente.
 */
@Injectable({ providedIn: 'root' })
export class PointCloudOverlayService implements SceneOverlay {
  private group: THREE.Group | null = null;
  private baseCloud: THREE.Points | null = null;
  private manipCloud: THREE.Points | null = null;
  private singularityCloud: THREE.Points | null = null;

  /** Attach this overlay to a Three.js scene. */
  attach(scene: THREE.Scene): void {
    if (this.group) return;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // ── Layer-specific setter methods ──

  /** Monochrome point cloud (default orange) — base workspace samples. */
  setBaseCloud(positions: [number, number, number][]): void {
    if (!this.group) return;
    this.clearMesh('base');

    const geo = this.buildPositionGeometry(positions);
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

    this.baseCloud = new THREE.Points(geo, mat);
    this.baseCloud.frustumCulled = true;
    this.group.add(this.baseCloud);
  }

  /**
   * Gradient point cloud from a normalized value [0, 1].
   * Green (1.0) → Yellow (0.5) → Red (0.0).
   */
  setManipulabilityCloud(
    points: { position: [number, number, number]; normalized: number }[],
  ): void {
    if (!this.group) return;
    this.clearMesh('manip');

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

    this.manipCloud = new THREE.Points(geo, mat);
    this.manipCloud.frustumCulled = true;
    this.group.add(this.manipCloud);
  }

  /** Colored point cloud based on singularity state. */
  setSingularityCloud(
    points: { position: [number, number, number]; state: 'normal' | 'near_singular' | 'singular' }[],
  ): void {
    if (!this.group) return;
    this.clearMesh('singularity');

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

    this.singularityCloud = new THREE.Points(geo, mat);
    this.singularityCloud.frustumCulled = true;
    this.group.add(this.singularityCloud);
  }

  // ── Visibility toggles (independent per layer) ──

  /** Show / hide the base cloud mesh. */
  showBase(visible: boolean): void {
    if (this.baseCloud) this.baseCloud.visible = visible;
  }

  /** Show / hide the manipulability cloud mesh. */
  showManipulability(visible: boolean): void {
    if (this.manipCloud) this.manipCloud.visible = visible;
  }

  /** Show / hide the singularity cloud mesh. */
  showSingularity(visible: boolean): void {
    if (this.singularityCloud) this.singularityCloud.visible = visible;
  }

  // ── Group-level visibility ──

  /** Hide all meshes without disposing resources. */
  hide(): void {
    if (this.group) {
      this.group.visible = false;
    }
  }

  // ── Clear methods (dispose GPU resources per layer) ──

  /** Remove and dispose the base cloud mesh. */
  clearBase(): void {
    this.clearMesh('base');
  }

  /** Remove and dispose the manipulability cloud mesh. */
  clearManipulability(): void {
    this.clearMesh('manip');
  }

  /** Remove and dispose the singularity cloud mesh. */
  clearSingularity(): void {
    this.clearMesh('singularity');
  }

  /** Clear all meshes and hide. */
  clear(): void {
    this.clearMesh('base');
    this.clearMesh('manip');
    this.clearMesh('singularity');
    if (this.group) {
      this.group.visible = false;
    }
  }

  /** Full cleanup — dispose all resources owned by this overlay. */
  dispose(): void {
    this.clear();
    if (this.group) {
      this.group.parent?.remove(this.group);
    }
    this.group = null;
  }

  // ── Backward-compatible aliases ──

  /** @deprecated Use setBaseCloud() instead. */
  setPointCloud(positions: [number, number, number][]): void {
    this.setBaseCloud(positions);
  }

  /** @deprecated Use setManipulabilityCloud() instead. */
  setGradientPointCloud(
    points: { position: [number, number, number]; normalized: number }[],
  ): void {
    this.setManipulabilityCloud(points);
  }

  /** @deprecated Use setSingularityCloud() instead. */
  setColoredPointCloud(
    points: { position: [number, number, number]; state: 'normal' | 'near_singular' | 'singular' }[],
  ): void {
    this.setSingularityCloud(points);
  }

  // ── Private helpers ──

  private buildPositionGeometry(positions: [number, number, number][]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i++) {
      vertices[i * 3]     = positions[i][0];
      vertices[i * 3 + 1] = positions[i][1];
      vertices[i * 3 + 2] = positions[i][2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    return geo;
  }

  private clearMesh(layer: 'base' | 'manip' | 'singularity'): void {
    let mesh: THREE.Points | null = null;
    switch (layer) {
      case 'base':
        mesh = this.baseCloud;
        this.baseCloud = null;
        break;
      case 'manip':
        mesh = this.manipCloud;
        this.manipCloud = null;
        break;
      case 'singularity':
        mesh = this.singularityCloud;
        this.singularityCloud = null;
        break;
    }
    if (mesh) {
      this.group?.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
