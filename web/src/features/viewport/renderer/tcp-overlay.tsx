import * as THREE from 'three'
import { useSceneStore } from '../store'

/**
 * TcpOverlay — indicador visual del Tool Center Point.
 * Muestra un anillo + cono en la posición del TCP.
 */
export function TcpOverlay() {
  const activeTcp = useSceneStore(s => s.activeTcp)
  const liveTransforms = useSceneStore(s => s.liveTransforms)
  const data = useSceneStore(s => s.data)

  if (!activeTcp || !data) return null

  // Buscar frame base: primero en liveTransforms (runtime), después en frames estáticos
  const frameId = String(activeTcp.baseFrameId)
  const liveTransform = liveTransforms.find(t => t.id === frameId)

  let position: THREE.Vector3

  if (liveTransform) {
    position = new THREE.Vector3(...liveTransform.translation)
  } else {
    const staticFrame = data.frames.find(f => f.id === frameId)
    if (!staticFrame) return null
    position = new THREE.Vector3(...staticFrame.translation)
  }

  // Aplicar offset del TCP
  if (activeTcp.offset) {
    position.add(new THREE.Vector3(...activeTcp.offset))
  }

  return (
    <group position={position}>
      {/* Anillo TCP */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.04, 0.006, 8, 24]} />
        <meshStandardMaterial color="#ff6633" emissive="#ff6633" emissiveIntensity={0.2} />
      </mesh>
      {/* Cono direccional */}
      <mesh position={[0, 0, 0.04]}>
        <coneGeometry args={[0.02, 0.04, 8]} />
        <meshStandardMaterial color="#ff6633" />
      </mesh>
    </group>
  )
}
