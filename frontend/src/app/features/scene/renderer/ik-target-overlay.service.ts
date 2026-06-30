import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SceneOverlay } from './scene-overlay.interface';

/**
 * Overlay que renderiza el gizmo del target IK:
 * esfera brillante + anillo orbital + ejes locales.
 */
@Injectable({ providedIn: 'root' })
export class IkTargetOverlayService implements SceneOverlay {
  private group: THREE.Group | null = null;

  /** Attach this overlay to a Three.js scene. */
  attach(scene: THREE.Scene): void {
    if (this.group) return;
    this.group = new THREE.Group();
    this.buildTargetGizmo(this.group);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Show the IK target gizmo at the given world position/orientation. */
  setTarget(position: [number, number, number], quaternion?: [number, number, number, number]): void {
    if (!this.group) return;
    this.group.position.set(position[0], position[1], position[2]);
    if (quaternion) {
      this.group.quaternion.set(quaternion[1], quaternion[2], quaternion[3], quaternion[0]);
    } else {
      this.group.quaternion.identity();
    }
    this.group.visible = true;
  }

  /** Hide the IK target gizmo. */
  clearTarget(): void {
    if (this.group) {
      this.group.visible = false;
    }
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

  /** Full cleanup — dispose all resources owned by this overlay. */
  dispose(): void {
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
