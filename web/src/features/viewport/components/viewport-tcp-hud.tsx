import { useMemo } from 'react'
import { useSceneStore } from '../store'
import { resolveTcpPosition, resolveFramePosition } from '../renderer/tcp-overlay'
import type { SceneFrame } from '../types'

/**
 * Derive the end-effector frame id from the scene frames: the leaf frame —
 * an id that never appears as another frame's parent (R5). Multiple leaves
 * pick the highest array index (deterministic). `null` when there are no
 * frames or every id is a parent of some frame (cycle). Pure — tested
 * directly.
 */
export function deriveEndEffectorId(frames: SceneFrame[] | null | undefined): string | null {
  if (!frames || frames.length === 0) return null
  const parentIds = new Set<string>()
  for (const frame of frames) {
    if (frame.parent !== null) parentIds.add(frame.parent)
  }
  let leafIndex = -1
  for (let i = 0; i < frames.length; i++) {
    if (!parentIds.has(frames[i].id)) leafIndex = i
  }
  return leafIndex === -1 ? null : frames[leafIndex].id
}

/**
 * Format a world-space distance for the TCP HUD (fmtDelta style): values
 * below 1 m render as whole mm with 2 decimals ("500.00 mm"), values of 1 m
 * and above render as m with 3 decimals ("1.250 m"). Pure — tested directly.
 */
export function fmtTcpPosition(meters: number): string {
  if (meters >= 1) return `${meters.toFixed(3)} m`
  return `${(meters * 1000).toFixed(2)} mm`
}

/**
 * ViewportTcpHud — floating chip (viewport bottom-left, grid-legend pattern)
 * showing the resolved TCP position as X/Y/Z in mm.
 *
 * ALWAYS VISIBLE WITH SCENE DATA (spec tcp-trace-grid-units R1): when
 * `activeTcp` is set the chip shows the TCP position via `resolveTcpPosition`;
 * when `activeTcp` is null the chip derives the end-effector frame
 * (`deriveEndEffectorId`) and resolves its position via `resolveFramePosition`.
 *
 * SHARED SUBSCRIPTION (R2): the HUD reads the SAME `activeTcp` /
 * `transformSnapshot` / `data` state as TcpOverlay and the robot model — a
 * single source of truth. There is NO polling, NO setInterval, NO second
 * snapshot fetch: position updates arrive through the store subscription on
 * the next execution tick (same render cycle as the robot).
 *
 * GRACEFUL DEGRADATION (R4): hidden when no position can be resolved — no
 * scene data, no frames and no TCP, or an unresolvable frame. Never renders
 * partial or invalid values.
 */
export function ViewportTcpHud() {
  const activeTcp = useSceneStore(s => s.activeTcp)
  const transformSnapshot = useSceneStore(s => s.transformSnapshot)
  const data = useSceneStore(s => s.data)

  const position = useMemo(() => {
    if (!data) return null
    if (activeTcp) return resolveTcpPosition(activeTcp, transformSnapshot, data)
    const endEffectorId = deriveEndEffectorId(data.frames)
    if (!endEffectorId) return null
    return resolveFramePosition(endEffectorId, transformSnapshot, data)
  }, [activeTcp, transformSnapshot, data])

  if (!position) return null

  return (
    <div
      data-testid="viewport-tcp-hud"
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/85 border border-border backdrop-blur-sm text-[11px]"
    >
      <span className="text-muted-foreground uppercase tracking-wider text-[10px]">TCP</span>
      <span className="font-mono text-cyan-400 tabular-nums">
        X: {fmtTcpPosition(position[0])}, Y: {fmtTcpPosition(position[1])}, Z: {fmtTcpPosition(position[2])}
      </span>
    </div>
  )
}
