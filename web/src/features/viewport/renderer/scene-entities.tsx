import { Html } from '@react-three/drei'
import { useDomainSceneStore } from '@/features/scene/store'
import type { SceneObject, SceneLocation } from '@/features/scene/store'
import type { PoseDef } from '@/shared/contracts'

/**
 * SceneEntities — renders the domain scene (objects/locations) in the 3D
 * viewport as meshes with name labels (design D7, scene-viewport-entities spec
 * R1/R2).
 *
 * Subscribes to `useDomainSceneStore` (cross-feature import: viewport →
 * features/scene, proposal decision (a)) and maps each entity to a mesh at its
 * world-coordinate pose plus a drei <Html> label. Empty store → null (R2).
 */

/** Mesh palette — no shared token exists for scene entities yet. */
const OBJECT_COLOR = 0x22c55e
const LOCATION_COLOR = 0xf59e0b
const ENTITY_SIZE = 0.08
const LOCATION_RADIUS = 0.05
/** Vertical offset (world units) of the name label above the entity. */
const LABEL_OFFSET = 0.1

/** Store quaternion `[w,x,y,z]` → THREE `[x,y,z,w]` (mirrors robot-model.tsx
 *  rustQuatToThree — R3F applies the `quaternion` prop in THREE order). */
function worldQuaternion([w, x, y, z]: [number, number, number, number]): [number, number, number, number] {
  return [x, y, z, w]
}

interface SceneEntityMeshProps {
  id: string
  name: string
  pose: PoseDef
  kind: 'object' | 'location'
}

function SceneEntityMesh({ id, name, pose, kind }: SceneEntityMeshProps) {
  const color = kind === 'object' ? OBJECT_COLOR : LOCATION_COLOR
  return (
    <group data-testid={`scene-entity-${id}`}>
      <mesh
        data-testid={`scene-entity-mesh-${id}`}
        position={pose.position}
        quaternion={worldQuaternion(pose.orientation)}
        frustumCulled={false}
      >
        {kind === 'object' ? (
          <boxGeometry args={[ENTITY_SIZE, ENTITY_SIZE, ENTITY_SIZE]} />
        ) : (
          <cylinderGeometry args={[LOCATION_RADIUS, LOCATION_RADIUS, ENTITY_SIZE, 16, 1]} />
        )}
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
      </mesh>
      <Html position={[0, LABEL_OFFSET, 0]} center className="pointer-events-none">
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
