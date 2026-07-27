import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { TCP_COLOR } from '@/shared/tokens'

export function TcpOverlay() {
  const activeTcp = useSceneStore(s => s.activeTcp)
  const liveTransforms = useSceneStore(s => s.liveTransforms)
  const data = useSceneStore(s => s.data)

  if (!activeTcp || !data) return null

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

  if (activeTcp.offset) {
    position.add(new THREE.Vector3(...activeTcp.offset))
  }

  const lineLen = 0.08

  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.06, 0.075, 32]} />
        <meshBasicMaterial color={TCP_COLOR} side={2} transparent opacity={0.6} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.02, 12, 12]} />
        <meshBasicMaterial color={TCP_COLOR} transparent opacity={0.9} />
      </mesh>
      <LinePoints points={[[-lineLen, 0, 0], [lineLen, 0, 0]]} />
      <LinePoints points={[[0, -lineLen, 0], [0, lineLen, 0]]} />
      <LinePoints points={[[0, 0, -lineLen], [0, 0, lineLen]]} />
    </group>
  )
}

function LinePoints({ points }: { points: [[number, number, number], [number, number, number]] }) {
  const line = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)))
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: TCP_COLOR, transparent: true, opacity: 0.4 }))
  }, [points])
  return <primitive object={line} />
}
