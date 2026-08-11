import { useSceneStore } from '../store'
import { IK_COLOR } from '@/shared/tokens'
import { scaleFromRefDim } from './scale'

export function IkGizmo() {
  const ikTarget = useSceneStore(s => s.ikTarget)
  // Ring/sphere sizes scale with the scene reference dimension — absent scene
  // data degrades to 1.0 via scaleFromRefDim (no-op, current sizes preserved).
  const refDim = useSceneStore(s => s.data?.referenceDimension) ?? 1.0
  if (!ikTarget) return null

  return (
    <group position={ikTarget.translation}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[scaleFromRefDim(refDim, 0.08), scaleFromRefDim(refDim, 0.10), 32]} />
        <meshBasicMaterial color={IK_COLOR} side={2} transparent opacity={0.5} depthTest={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[scaleFromRefDim(refDim, 0.025), 12, 12]} />
        <meshBasicMaterial color={IK_COLOR} transparent opacity={0.9} />
      </mesh>
      <mesh>
        <sphereGeometry args={[scaleFromRefDim(refDim, 0.09), 16, 8]} />
        <meshBasicMaterial color={IK_COLOR} wireframe transparent opacity={0.25} />
      </mesh>
    </group>
  )
}
