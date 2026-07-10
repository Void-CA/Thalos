import { Injectable, NgZone, inject } from '@angular/core';
import * as THREE from 'three';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { SceneOverlay } from './scene-overlay.interface';
import { SegmentInfo, VisualWaypoint } from '../scene.types';
import type { WaypointModel, WaypointType } from '../../planning/planning.types';

/** Color mapping for planning waypoints by type. */
const WP_COLORS: Record<WaypointType, number> = {
  Start: 0x44cc44,
  Goal:  0xcc4444,
  Via:   0x888888,
};

/** Highlight color for the selected waypoint. */
const WP_HIGHLIGHT_COLOR = 0x33ccff;

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

  // ── Planning waypoint state ──

  private waypointGroup: THREE.Group | null = null;
  private waypointMeshes = new Map<string, THREE.Mesh>();
  private readonly waypointGeo = new THREE.SphereGeometry(0.05, 16, 16);
  private highlightMesh: THREE.Mesh | null = null;
  private dragControls: DragControls | null = null;
  private readonly ngZone = inject(NgZone);

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

  // ──────────────────────────────────────────────
  // Planning waypoint methods (Track A)
  // ──────────────────────────────────────────────

  /**
   * Sync planning waypoints as draggable color-coded spheres.
   * Replaces all existing waypoint meshes.
   */
  syncWaypoints(waypoints: WaypointModel[], selectedId: string | null): void {
    this.clearWaypoints();
    if (!this.group || waypoints.length === 0) return;

    const grp = new THREE.Group();
    this.waypointMeshes.clear();

    for (const wp of waypoints) {
      const color = WP_COLORS[wp.type] ?? 0x888888;
      const mat = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(this.waypointGeo.clone(), mat);
      mesh.position.set(wp.position[0], wp.position[1], wp.position[2]);
      mesh.quaternion.set(
        wp.orientation[1],
        wp.orientation[2],
        wp.orientation[3],
        wp.orientation[0],
      );
      mesh.userData['waypointId'] = wp.id;
      grp.add(mesh);
      this.waypointMeshes.set(wp.id, mesh);
    }

    this.group.add(grp);
    this.waypointGroup = grp;

    // Apply initial highlight
    if (selectedId) {
      this.highlightWaypoint(selectedId);
    }
  }

  /** Remove all planning waypoint meshes from the scene. */
  clearWaypoints(): void {
    this.disableDragControls();
    this.highlightMesh = null;
    this.waypointMeshes.clear();
    if (this.waypointGroup) {
      this.group?.remove(this.waypointGroup);
      this.disposeGroup(this.waypointGroup);
      this.waypointGroup = null;
    }
  }

  /**
   * Raycast against waypoint meshes.
   * @returns The waypoint ID of the closest hit, or null.
   */
  pickWaypoint(raycaster: THREE.Raycaster): string | null {
    const meshes: THREE.Mesh[] = [];
    for (const mesh of this.waypointMeshes.values()) {
      meshes.push(mesh);
    }
    if (meshes.length === 0) return null;

    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return null;

    const hit = hits[0].object;
    const id = hit.userData['waypointId'] as string | undefined;
    return id ?? null;
  }

  /**
   * Toggle highlight effect on the selected waypoint.
   * The previously highlighted waypoint is restored to the current
   * color for its type. Pass null to clear all highlights.
   */
  highlightWaypoint(id: string | null): void {
    // Reset previous highlight — restore from stored original color
    if (this.highlightMesh) {
      const prevMat = this.highlightMesh.material as THREE.MeshStandardMaterial;
      const stored = this.highlightMesh.userData['_origColor'] as number | undefined;
      if (stored !== undefined) {
        prevMat.color.setHex(stored);
      }
      this.highlightMesh = null;
    }

    if (!id) return;

    const mesh = this.waypointMeshes.get(id);
    if (!mesh) return;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    mesh.userData['_origColor'] = mat.color.getHex();
    mat.color.setHex(WP_HIGHLIGHT_COLOR);
    this.highlightMesh = mesh;
  }

  /**
   * Enable DragControls for waypoint spheres.
   * Callbacks are invoked outside Angular zone for performance.
   *
   * @param camera  — Three.js camera (from ThreeRendererService)
   * @param domElement — renderer canvas DOM element
   * @param onDragStart — called when drag begins: (id) => void
   * @param onDrag — called during drag with live position: (id, position) => void
   * @param onDragEnd — called when drag completes: (id, position) => void
   */
  enableDragControls(
    camera: THREE.Camera,
    domElement: HTMLElement,
    callbacks: {
      onDragStart?: (id: string) => void;
      onDrag?: (id: string, position: [number, number, number]) => void;
      onDragEnd?: (id: string, position: [number, number, number]) => void;
    },
  ): void {
    this.disableDragControls();

    const objects = Array.from(this.waypointMeshes.values());
    if (objects.length === 0) return;

    const controls = new DragControls(objects, camera, domElement);

    controls.addEventListener('dragstart', (event: any) => {
      const id = event.object.userData['waypointId'] as string | undefined;
      if (id && callbacks.onDragStart) {
        this.ngZone.run(() => callbacks.onDragStart!(id));
      }
    });

    controls.addEventListener('drag', (event: any) => {
      const id = event.object.userData['waypointId'] as string | undefined;
      if (id && callbacks.onDrag) {
        const p = event.object.position;
        this.ngZone.run(() =>
          callbacks.onDrag!(id, [p.x, p.y, p.z]),
        );
      }
    });

    controls.addEventListener('dragend', (event: any) => {
      const id = event.object.userData['waypointId'] as string | undefined;
      if (id && callbacks.onDragEnd) {
        const p = event.object.position;
        this.ngZone.run(() =>
          callbacks.onDragEnd!(id, [p.x, p.y, p.z]),
        );
      }
    });

    this.dragControls = controls;
  }

  /** Dispose of DragControls instance. */
  disableDragControls(): void {
    if (this.dragControls) {
      this.dragControls.dispose();
      this.dragControls = null;
    }
  }

  // ── Private helpers ──

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
    this.clearWaypoints();
    this.waypointGeo.dispose();
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
