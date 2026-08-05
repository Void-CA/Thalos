import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { TCP_COLOR } from '@/shared/tokens'
import type { SceneData, ToolFrame, TransformSnapshot } from '../types'

/**
 * Resolve the world-space position of the TCP marker.
 *
 * - When the backend FK result is present (`resolvedPose`), it wins — the
 *   marker goes exactly where the resolved pose says (tcp-resolved-pose R5.1).
 * - Otherwise fall back to the local derivation: base frame position from the
 *   same transform source that drives the robot model (execution ticks, FK
 *   frames, then the static scene) plus the TCP offset (R5.2).
 * - `null` when the frame cannot be resolved at all.
 */
export function resolveTcpPosition(
  activeTcp: ToolFrame,
  transformSnapshot: TransformSnapshot,
  data: SceneData | null,
): [number, number, number] | null {
  if (activeTcp.resolvedPose) return activeTcp.resolvedPose.position

  const frameId = String(activeTcp.baseFrameId)

  let framePosition: [number, number, number] | null = null
  if (transformSnapshot.kind === 'execution') {
    const tx = transformSnapshot.transforms.find(t => t.id === frameId)
    if (tx) framePosition = tx.translation
  } else if (transformSnapshot.kind === 'fk') {
    const frame = transformSnapshot.frames.get(frameId)
    if (frame) framePosition = frame.pos
  }
  if (!framePosition && data) {
    const staticFrame = data.frames.find(f => f.id === frameId)
    if (staticFrame) framePosition = staticFrame.translation
  }
  if (!framePosition) return null

  const [fx, fy, fz] = framePosition
  if (activeTcp.offset) {
    const [ox, oy, oz] = activeTcp.offset
    return [fx + ox, fy + oy, fz + oz]
  }
  return [fx, fy, fz]
}

export function TcpOverlay() {
  const activeTcp = useSceneStore(s => s.activeTcp)
  const transformSnapshot = useSceneStore(s => s.transformSnapshot)
  const data = useSceneStore(s => s.data)

  const position = useMemo(
    () => (activeTcp ? resolveTcpPosition(activeTcp, transformSnapshot, data) : null),
    [activeTcp, transformSnapshot, data],
  )

  if (!position) return null

  const lineLen = 0.08

  return (
    <group position={new THREE.Vector3(...position)} data-testid="tcp-overlay-marker">
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
