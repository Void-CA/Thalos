import { useMemo } from 'react'
import { useSceneStore } from '../store'
import { resolveTcpPosition } from '../renderer/tcp-overlay'

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
 * ViewportTcpHud — floating chip (viewport bottom-left, diff-overlay pattern)
 * showing the resolved TCP position as X/Y/Z in mm while a TCP is active.
 *
 * SHARED SUBSCRIPTION (spec viewport-tcp-hud): the HUD reads the SAME
 * `activeTcp` / `transformSnapshot` / `data` state as TcpOverlay and the robot
 * model — a single source of truth. There is NO polling, NO setInterval, NO
 * second snapshot fetch: position updates arrive through the store
 * subscription on the next execution tick (same render cycle as the robot).
 * Hidden when no TCP is active or the position cannot be resolved.
 */
export function ViewportTcpHud() {
  const activeTcp = useSceneStore(s => s.activeTcp)
  const transformSnapshot = useSceneStore(s => s.transformSnapshot)
  const data = useSceneStore(s => s.data)

  const position = useMemo(
    () => (activeTcp ? resolveTcpPosition(activeTcp, transformSnapshot, data) : null),
    [activeTcp, transformSnapshot, data],
  )

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
