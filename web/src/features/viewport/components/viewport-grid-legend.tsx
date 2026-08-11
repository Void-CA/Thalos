import { useSceneStore } from '../store'

/** Number of grid divisions SceneGrid renders (gridHelper args[1]). */
export const GRID_DIVISIONS = 10

/**
 * Per-square size of the SceneGrid, mirroring its exact `size` contract:
 * `size = max(refDim*4, 0.5)` over `GRID_DIVISIONS` divisions. Absent
 * reference dimension degrades to 1.0 (same fallback as the grid). Pure —
 * the legend can never desync from the rendered grid.
 */
export function gridSquareSize(refDim: number | null | undefined): number {
  const dim = refDim ?? 1.0
  return Math.max(dim * 4, 0.5) / GRID_DIVISIONS
}

/**
 * Format one grid square in meters (spec viewport-grid-legend unit policy).
 * Unambiguous, mm/m only, NO cm:
 * - square < 1 m → whole mm, minimum 1 ("80 mm", "999 mm")
 * - square ≥ 1 m → m with up to 2 decimals ("1 m", "1.2 m", "1.23 m")
 */
export function formatGridSquare(squareMeters: number): string {
  if (squareMeters < 1) {
    const mm = Math.max(Math.round(squareMeters * 1000), 1)
    return `${mm} mm`
  }
  return `${parseFloat(squareMeters.toFixed(2))} m`
}

/** Legend label for a scene reference dimension: "grid = {value} {unit}". */
export function gridLegendLabel(refDim: number | null | undefined): string {
  return `grid = ${formatGridSquare(gridSquareSize(refDim))}`
}

/**
 * ViewportGridLegend — floating chip (viewport bottom-left, next to the TCP
 * HUD) showing what each SceneGrid square equals ("grid = 80 mm"). Computed
 * from the SAME size/divisions SceneGrid renders, so it stays consistent for
 * any referenceDimension. Hidden when the grid is hidden (no scene data).
 */
export function ViewportGridLegend() {
  const data = useSceneStore(s => s.data)
  if (!data) return null

  return (
    <div
      data-testid="viewport-grid-legend"
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/85 border border-border backdrop-blur-sm text-[11px]"
    >
      <span className="font-mono text-muted-foreground tabular-nums">{gridLegendLabel(data.referenceDimension)}</span>
    </div>
  )
}
