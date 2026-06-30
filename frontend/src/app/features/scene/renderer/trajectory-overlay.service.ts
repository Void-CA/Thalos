import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SceneOverlay } from './scene-overlay.interface';
import { SegmentInfo, VisualWaypoint } from '../scene.types';

/** Palette for multi-segment trajectories — color assigned by segment index. */
const SEGMENT_PALETTE = [
  0x3b82f6, // blue
  0x22c55e, // green
  0xf59e0b, // amber
  0xef4444, // red
  0x8b5cf6, // violet
  0xec4899, // pink
  0x14b8a6, // teal
  0xf97316, // orange
];

interface TrajectorySlot {
  group: THREE.Group;
  lines: THREE.Line[];
  markers: THREE.Mesh[];
}

/**
 * Overlay que renderiza la trayectoria del plan activo:
 * path lines + waypoint markers, con soporte multi-segmento.
 */
@Injectable({ providedIn: 'root' })
export class TrajectoryOverlayService implements SceneOverlay {
  private group: THREE.Group | null = null;
  private slot: TrajectorySlot | null = null;

  /** Attach this overlay to a Three.js scene. */
  attach(scene: THREE.Scene): void {
    if (this.group) return;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  /**
   * Render or update the trajectory path + waypoint markers.
   * Clears any previous trajectory before building the new one.
   */
  syncTrajectory(
    waypoints: VisualWaypoint[],
    motionType?: string,
    segments?: SegmentInfo[],
  ): void {
    this.clearTrajectory();
    if (!this.group) return;
    if (waypoints.length < 2) return;

    const wrapper = new THREE.Group();
    const lines: THREE.Line[] = [];
    const markers: THREE.Mesh[] = [];
    const markerGeo = new THREE.SphereGeometry(0.005, 12, 12);
    const pts = waypoints.map(wp => new THREE.Vector3(wp.position[0], wp.position[1], wp.position[2]));

    if (segments && segments.length > 0) {
      // ── Multi-segment: color each segment by palette index ──
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        const color = SEGMENT_PALETTE[s % SEGMENT_PALETTE.length];

        // Per-segment path line
        const segPts = pts.slice(seg.waypointStart, seg.waypointEnd);
        if (segPts.length >= 2) {
          const lineGeo = new THREE.BufferGeometry().setFromPoints(segPts);
          const lineMat = new THREE.LineBasicMaterial({ color });
          const line = new THREE.Line(lineGeo, lineMat);
          wrapper.add(line);
          lines.push(line);
        }

        // Per-segment markers
        for (let i = seg.waypointStart; i < seg.waypointEnd; i++) {
          const wp = waypoints[i];
          const mat = new THREE.MeshStandardMaterial({ color });
          const mesh = new THREE.Mesh(markerGeo.clone(), mat);
          mesh.position.set(wp.position[0], wp.position[1], wp.position[2]);
          mesh.quaternion.set(wp.orientation[1], wp.orientation[2], wp.orientation[3], wp.orientation[0]);
          wrapper.add(mesh);
          markers.push(mesh);
        }
      }
    } else {
      // ── Single motion: color by motion type ──
      const lineColor = motionType === 'movel' ? 0x33ccff : 0xff8800;
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({ color: lineColor });
      const line = new THREE.Line(lineGeo, lineMat);
      wrapper.add(line);
      lines.push(line);

      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        let color: number;
        switch (wp.waypointType) {
          case 'Start':
            color = 0x44cc44;
            break;
          case 'Goal':
            color = 0xcc4444;
            break;
          default:
            color = 0xcccccc;
            break;
        }

        const mat = new THREE.MeshStandardMaterial({ color });
        const mesh = new THREE.Mesh(markerGeo.clone(), mat);
        mesh.position.set(wp.position[0], wp.position[1], wp.position[2]);
        mesh.quaternion.set(wp.orientation[1], wp.orientation[2], wp.orientation[3], wp.orientation[0]);
        wrapper.add(mesh);
        markers.push(mesh);
      }
    }

    this.group.add(wrapper);
    this.slot = { group: wrapper, lines, markers };
  }

  /** Remove the trajectory overlay from the scene. */
  clearTrajectory(): void {
    if (!this.slot) return;
    this.group?.remove(this.slot.group);
    this.disposeTrajectory(this.slot);
    this.slot = null;
  }

  private disposeTrajectory(slot: TrajectorySlot): void {
    for (const line of slot.lines) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    for (const m of slot.markers) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }

  /** Full cleanup — dispose all resources owned by this overlay. */
  dispose(): void {
    this.clearTrajectory();
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
