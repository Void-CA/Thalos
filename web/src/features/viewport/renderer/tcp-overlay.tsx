import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { TCP_COLOR } from '@/shared/tokens'
import { scaleFromRefDim } from './scale'
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

/** Height of the pyramid as a ratio of referenceDimension — bounded well under
 *  the 0.15 ceiling so the marker never dominates the robot geometry. */
const TCP_PYRAMID_HEIGHT_RATIO = 0.12
/** Base edge as a ratio of the height (~0.6) — the dominant visual dimension
 *  stays the bounded height. */
const TCP_BASE_EDGE_RATIO = 0.6

/** Pyramid size contract: height = scaleFromRefDim(refDim, ratio) bounded to
 *  ≤ 0.15 × refDim, base edge ≈ 0.6 × height. Pure — tested directly. */
export function tcpPyramidDimensions(refDim: number | undefined | null): { height: number; baseEdge: number } {
  const height = scaleFromRefDim(refDim, TCP_PYRAMID_HEIGHT_RATIO)
  return { height, baseEdge: height * TCP_BASE_EDGE_RATIO }
}

/** Store quaternion `[w,x,y,z]` → THREE `[x,y,z,w]` (same as robot-model
 *  rustQuatToThree — R3F applies the `quaternion` prop in THREE order). */
function rustQuatToThree([w, x, y, z]: [number, number, number, number]): [number, number, number, number] {
  return [x, y, z, w]
}

/**
 * World orientation of the tool frame, from the same transform source that
 * drives position: the backend resolved pose wins; otherwise the execution
 * tick / FK frame / static scene frame rotation for the base frame id.
 * `null` when no orientation source exists.
 */
function resolveTcpOrientation(
  activeTcp: ToolFrame,
  transformSnapshot: TransformSnapshot,
  data: SceneData | null,
): [number, number, number, number] | null {
  if (activeTcp.resolvedPose) return rustQuatToThree(activeTcp.resolvedPose.orientation)

  const frameId = String(activeTcp.baseFrameId)
  if (transformSnapshot.kind === 'execution') {
    const tx = transformSnapshot.transforms.find(t => t.id === frameId)
    if (tx) return rustQuatToThree(tx.rotation)
  } else if (transformSnapshot.kind === 'fk') {
    const frame = transformSnapshot.frames.get(frameId)
    if (frame) return rustQuatToThree(frame.quat)
  }
  if (data) {
    const staticFrame = data.frames.find(f => f.id === frameId)
    if (staticFrame) return rustQuatToThree(staticFrame.rotation)
  }
  return null
}

export function TcpOverlay() {
  const activeTcp = useSceneStore(s => s.activeTcp)
  const transformSnapshot = useSceneStore(s => s.transformSnapshot)
  const data = useSceneStore(s => s.data)

  const position = useMemo(
    () => (activeTcp ? resolveTcpPosition(activeTcp, transformSnapshot, data) : null),
    [activeTcp, transformSnapshot, data],
  )

  const orientation = useMemo(
    () => (activeTcp ? resolveTcpOrientation(activeTcp, transformSnapshot, data) : null),
    [activeTcp, transformSnapshot, data],
  )

  const refDim = data?.referenceDimension ?? 1.0

  if (!position) return null

  // Pyramid marker (tcp-resolved-pose MODIFIED): a 4-segment cone whose apex
  // points +Y in local cone space, flipped +π/2 about X so it points the tool
  // frame's LOCAL +Z (rotation about X by +π/2 carries +Y → +Z; the previous
  // -π/2 flip mapped +Y → -Z and pointed the apex down at identity). The tool
  // orientation quaternion sits on the marker group and composes with the
  // local flip — the apex follows the tool, never global +Z. The wireframe
  // material keeps the base subtle.
  const { height, baseEdge } = tcpPyramidDimensions(refDim)
  const radius = baseEdge / Math.SQRT2 // circumradius of the square base

  return (
    <group
      position={new THREE.Vector3(...position)}
      quaternion={orientation ?? [0, 0, 0, 1]}
      data-testid="tcp-overlay-marker"
    >
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[radius, height, 4]} />
        <meshBasicMaterial color={TCP_COLOR} wireframe transparent opacity={0.25} />
      </mesh>
    </group>
  )
}
