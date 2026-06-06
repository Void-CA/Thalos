// ── Rotation conversion: wire format ↔ Three.js quaternion ──
//
// The backend (Rust + thalos_core::UnitQuaternion) is the single source of
// truth for rotation math. On the frontend, the equivalent is Three.js's
// Quaternion/Euler — we use it here as a thin dispatcher so the gizmo
// preview can render the IK target before the backend response arrives.
//
// YPR convention: ZYX intrinsic (roll around X, then pitch around Y, then
// yaw around Z). Matches `UnitQuaternion::from_euler` / `to_euler` on the
// backend — keep these in sync.

import * as THREE from 'three';
import type { RotationDto } from '../scene-api.types';

/**
 * Convert a wire-format `RotationDto` (Quaternion or ZYX Euler in radians)
 * into a `[w, x, y, z]` tuple suitable for Three.js.
 */
export function rotationDtoToQuaternion(
  r: RotationDto,
): [number, number, number, number] {
  if (r.kind === 'Quaternion') {
    return [r.value.w, r.value.x, r.value.y, r.value.z];
  }

  // YPR (ZYX intrinsic) — Three.js Euler with the matching order
  const euler = new THREE.Euler(
    r.value.roll,   // X axis
    r.value.pitch,  // Y axis
    r.value.yaw,    // Z axis
    'ZYX',
  );
  const q = new THREE.Quaternion().setFromEuler(euler);
  return [q.w, q.x, q.y, q.z];
}
