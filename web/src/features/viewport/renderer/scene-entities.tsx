import { Html } from '@react-three/drei'
import { useDomainSceneStore } from '@/features/scene/store'
import type { SceneObject, SceneLocation } from '@/features/scene/store'
import type { PoseDef } from '@/shared/contracts'
import { useSceneStore } from '../store'
import { scaleFromRefDim } from './scale'

/**
 * SceneEntities — renders the domain scene (objects/locations) in the 3D
 * viewport as meshes with name labels (design D7, scene-viewport-entities spec
 * R1/R2 + Z-up delta).
 *
 * Subscribes to `useDomainSceneStore` (cross-feature import: viewport →
 * features/scene, proposal decision (a)) and maps each entity to a mesh at its
 * world-coordinate pose plus a drei <Html> label. Empty store → null (R2).
 *
 * Z-up (scene-viewport-entities MODIFIED): location cylinders are laid flat by
 * composing the π/2-about-X rotation INTO the pose quaternion (R3-002 — a
 * separate `rotation` prop would overwrite `pose.orientation`), labels anchor
 * above the entity at `[0, 0, LABEL_OFFSET]`, and a location whose z is 0 is
 * nudged to `ENTITY_SIZE/2` so its half-height clears the floor plane.
 */

/** Mesh palette — no shared token exists for scene entities yet. */
const OBJECT_COLOR = 0x22c55e
const LOCATION_COLOR = 0xf59e0b
/** Entity size at referenceDimension = 1.0 — scaled by `scaleFromRefDim`. */
export const ENTITY_SIZE = 0.08
/** Location radius at referenceDimension = 1.0 — scaled by `scaleFromRefDim`. */
const LOCATION_RADIUS = 0.05
/** Vertical offset (world units) of the name label above the entity (Z-up),
 *  at referenceDimension = 1.0 — scaled by `scaleFromRefDim`. */
export const LABEL_OFFSET = 0.1

/** Store quaternion `[w,x,y,z]` → THREE `[x,y,z,w]` (mirrors robot-model.tsx
 *  rustQuatToThree — R3F applies the `quaternion` prop in THREE order). */
function worldQuaternion([w, x, y, z]: [number, number, number, number]): [number, number, number, number] {
  return [x, y, z, w]
}

/** q_π2_x — flat-lay rotation π/2 about X in store `[w,x,y,z]` order (lays a
 *  Y-axis cylinder flat on the XY plane, Z-up delta). */
const FLAT_LAY_QUAT: [number, number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0, 0]

/** Hamilton product `a ⊗ b` of two store-order `[w,x,y,z]` quaternions. */
function multiplyQuaternion(
  [w1, x1, y1, z1]: [number, number, number, number],
  [w2, x2, y2, z2]: [number, number, number, number],
): [number, number, number, number] {
  return [
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
  ]
}

/**
 * Effective orientation of a location mesh (R3-002): the flat-lay rotation
 * composed WITH the pose quaternion into a SINGLE transform, in THREE order.
 * R3F applyProps iterates props in JSX order — a separate `rotation` prop
 * declared after `quaternion` fires `quaternion.setFromEuler` and DISCARDS
 * `pose.orientation`. Composing q_π2_x ⊗ q_pose into the quaternion itself
 * preserves non-identity orientations while keeping the cylinder flat.
 */
export function locationQuaternion(poseOrientation: PoseDef['orientation']): [number, number, number, number] {
  return worldQuaternion(multiplyQuaternion(FLAT_LAY_QUAT, poseOrientation))
}

/** Z-up: a location at z=0 sits half its height above the floor plane instead
 *  of intersecting it; any other entity keeps its exact pose. Pure — trivially
 *  re-evaluated on every store re-render (live pose edits included). */
function nudgeToFloor(position: PoseDef['position'], kind: 'object' | 'location', entitySize: number): PoseDef['position'] {
  if (kind === 'location' && position[2] === 0) {
    return [position[0], position[1], entitySize / 2]
  }
  return position
}

interface SceneEntityMeshProps {
  id: string
  name: string
  pose: PoseDef
  kind: 'object' | 'location'
  /** Scene reference dimension — overlay sizes scale with it (no-op at 1.0). */
  refDim: number
}

function SceneEntityMesh({ id, name, pose, kind, refDim }: SceneEntityMeshProps) {
  const color = kind === 'object' ? OBJECT_COLOR : LOCATION_COLOR
  // Overlay sizes derive from referenceDimension via the shared helper — the
  // fallback lives in scaleFromRefDim, components never inline `refDim ?? 1`.
  const entitySize = scaleFromRefDim(refDim, ENTITY_SIZE)
  const locationRadius = scaleFromRefDim(refDim, LOCATION_RADIUS)
  const labelOffset = scaleFromRefDim(refDim, LABEL_OFFSET)
  const position = nudgeToFloor(pose.position, kind, entitySize)
  // R3-002: locations carry the flat-lay rotation composed INTO the quaternion
  // (q_π2_x ⊗ q_pose) — a separate `rotation` prop would overwrite the pose.
  const quaternion = kind === 'location' ? locationQuaternion(pose.orientation) : worldQuaternion(pose.orientation)
  return (
    <group data-testid={`scene-entity-${id}`}>
      <mesh
        data-testid={`scene-entity-mesh-${id}`}
        position={position}
        quaternion={quaternion}
        frustumCulled={false}
      >
        {kind === 'object' ? (
          <boxGeometry args={[entitySize, entitySize, entitySize]} />
        ) : (
          <cylinderGeometry args={[locationRadius, locationRadius, entitySize, 16, 1]} />
        )}
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <Html position={[0, 0, labelOffset]} center className="pointer-events-none">
        <div className="select-none whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {name}
        </div>
      </Html>
    </group>
  )
}

export function SceneEntities() {
  // Selector subscription — live pose edits in the editor re-render the meshes
  // (spec R1.3). Selecting each array re-renders only when that array changes.
  const objects = useDomainSceneStore(s => s.objects)
  const locations = useDomainSceneStore(s => s.locations)
  // Overlay sizes scale with the scene reference dimension (viewport store) —
  // absent scene data degrades to 1.0 via scaleFromRefDim (no-op).
  const refDim = useSceneStore(s => s.data?.referenceDimension) ?? 1.0

  if (objects.length === 0 && locations.length === 0) return null

  return (
    <group>
      {objects.map((obj: SceneObject) => (
        <SceneEntityMesh key={obj.id} id={obj.id} name={obj.name} pose={obj.pose} kind="object" refDim={refDim} />
      ))}
      {locations.map((loc: SceneLocation) => (
        <SceneEntityMesh key={loc.id} id={loc.id} name={loc.name} pose={loc.pose} kind="location" refDim={refDim} />
      ))}
    </group>
  )
}
