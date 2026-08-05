import { Html } from '@react-three/drei'
import { useDomainSceneStore } from '@/features/scene/store'
import type { SceneObject, SceneLocation } from '@/features/scene/store'
import type { PoseDef } from '@/shared/contracts'

/**
 * SceneEntities — renders the domain scene (objects/locations) in the 3D
 * viewport as meshes with name labels (design D7, scene-viewport-entities spec
 * R1/R2 + Z-up delta).
 *
 * Subscribes to `useDomainSceneStore` (cross-feature import: viewport →
 * features/scene, proposal decision (a)) and maps each entity to a mesh at its
 * world-coordinate pose plus a drei <Html> label. Empty store → null (R2).
 *
 * Z-up (scene-viewport-entities MODIFIED): location cylinders are rotated π/2
 * about X so their axis lies along Z (flat on the XY plane), labels anchor
 * above the entity at `[0, 0, LABEL_OFFSET]`, and a location whose z is 0 is
 * nudged to `ENTITY_SIZE/2` so its half-height clears the floor plane.
 */

/** Mesh palette — no shared token exists for scene entities yet. */
const OBJECT_COLOR = 0x22c55e
const LOCATION_COLOR = 0xf59e0b
export const ENTITY_SIZE = 0.08
const LOCATION_RADIUS = 0.05
/** Vertical offset (world units) of the name label above the entity (Z-up). */
export const LABEL_OFFSET = 0.1

/** Store quaternion `[w,x,y,z]` → THREE `[x,y,z,w]` (mirrors robot-model.tsx
 *  rustQuatToThree — R3F applies the `quaternion` prop in THREE order). */
function worldQuaternion([w, x, y, z]: [number, number, number, number]): [number, number, number, number] {
  return [x, y, z, w]
}

/** Z-up: a location at z=0 sits half its height above the floor plane instead
 *  of intersecting it; any other entity keeps its exact pose. Pure — trivially
 *  re-evaluated on every store re-render (live pose edits included). */
function nudgeToFloor(position: PoseDef['position'], kind: 'object' | 'location'): PoseDef['position'] {
  if (kind === 'location' && position[2] === 0) {
    return [position[0], position[1], ENTITY_SIZE / 2]
  }
  return position
}

interface SceneEntityMeshProps {
  id: string
  name: string
  pose: PoseDef
  kind: 'object' | 'location'
}

function SceneEntityMesh({ id, name, pose, kind }: SceneEntityMeshProps) {
  const color = kind === 'object' ? OBJECT_COLOR : LOCATION_COLOR
  const position = nudgeToFloor(pose.position, kind)
  // Z-up: cylinder default axis is Y (THREE) → π/2 about X lays it flat on XY.
  const rotation: [number, number, number] | undefined = kind === 'location' ? [Math.PI / 2, 0, 0] : undefined
  return (
    <group data-testid={`scene-entity-${id}`}>
      <mesh
        data-testid={`scene-entity-mesh-${id}`}
        position={position}
        quaternion={worldQuaternion(pose.orientation)}
        rotation={rotation}
        frustumCulled={false}
      >
        {kind === 'object' ? (
          <boxGeometry args={[ENTITY_SIZE, ENTITY_SIZE, ENTITY_SIZE]} />
        ) : (
          <cylinderGeometry args={[LOCATION_RADIUS, LOCATION_RADIUS, ENTITY_SIZE, 16, 1]} />
        )}
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <Html position={[0, 0, LABEL_OFFSET]} center className="pointer-events-none">
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

  if (objects.length === 0 && locations.length === 0) return null

  return (
    <group>
      {objects.map((obj: SceneObject) => (
        <SceneEntityMesh key={obj.id} id={obj.id} name={obj.name} pose={obj.pose} kind="object" />
      ))}
      {locations.map((loc: SceneLocation) => (
        <SceneEntityMesh key={loc.id} id={loc.id} name={loc.name} pose={loc.pose} kind="location" />
      ))}
    </group>
  )
}
