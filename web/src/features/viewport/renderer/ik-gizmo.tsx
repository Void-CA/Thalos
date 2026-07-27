import { useSceneStore } from '../store'

/**
 * IkGizmo — target visual del IK solver.
 *
 * Matching Angular (three-renderer.service.ts → buildTargetGizmo):
 *   - Ring: RingGeometry(0.08, 0.10, 32), #ff6600, DoubleSide, opacity 0.5
 *   - Center dot: SphereGeometry(0.025, 12, 12), #ff6600, opacity 0.9
 *   - Wireframe crosshair: SphereGeometry(wireR=0.09, 16, 8), #ff6600, opacity 0.25
 */
export function IkGizmo() {
  const ikTarget = useSceneStore(s => s.ikTarget)

  if (!ikTarget) return null

  return (
    <group position={ikTarget.translation}>
      {/* Outer ring — primary visual indicator */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.10, 32]} />
        <meshBasicMaterial
          color="#ff6600"
          side={2} // DoubleSide
          transparent
          opacity={0.5}
          depthTest={false}
        />
      </mesh>

      {/* Center dot */}
      <mesh>
        <sphereGeometry args={[0.025, 12, 12]} />
        <meshBasicMaterial
          color="#ff6600"
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Wireframe crosshair sphere — makes orientation obvious */}
      <mesh>
        <sphereGeometry args={[0.09, 16, 8]} />
        <meshBasicMaterial
          color="#ff6600"
          wireframe
          transparent
          opacity={0.25}
        />
      </mesh>
    </group>
  )
}
