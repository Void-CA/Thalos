import { useSceneStore } from '../store'

/**
 * IkGizmo — esfera arrastrable que representa el target IK.
 * Por ahora solo muestra la posición; el drag se habilita en una iteración futura.
 */
export function IkGizmo() {
  const ikTarget = useSceneStore(s => s.ikTarget)

  if (!ikTarget) return null

  return (
    <mesh position={ikTarget.translation}>
      <sphereGeometry args={[0.03, 16, 16]} />
      <meshStandardMaterial
        color="#33ccff"
        emissive="#33ccff"
        emissiveIntensity={0.3}
        transparent
        opacity={0.8}
      />
    </mesh>
  )
}
