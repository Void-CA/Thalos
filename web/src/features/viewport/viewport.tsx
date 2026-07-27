import { useMemo } from 'react'
import { useSceneStore } from './store'
import { SceneCanvas } from './renderer/scene-canvas'
import { Loader2, Move } from 'lucide-react'

// ── Helpers (mismos que en optimization-panel, sin dependencias externas) ──

interface PositionDiff {
  avgDelta: number
  maxDelta: number
  movedCount: number
  matched: number
}

function computeDiff(
  original: { position: [number, number, number] }[],
  optimized: number[][],
): PositionDiff | null {
  const n = Math.min(original.length, optimized.length)
  if (n < 1) return null
  let sum = 0, max = 0, moved = 0
  for (let i = 0; i < n; i++) {
    const [ox, oy, oz] = original[i].position
    const [tx, ty, tz] = optimized[i]
    const d = Math.hypot(tx - ox, ty - oy, tz - oz)
    sum += d
    if (d > max) max = d
    if (d > 0.0001) moved++
  }
  return { avgDelta: sum / n, maxDelta: max, movedCount: moved, matched: n }
}

function fmtDelta(meters: number): string {
  if (meters >= 1) return `${meters.toFixed(3)} m`
  return `${(meters * 1000).toFixed(1)} mm`
}

/**
 * Viewport — contenedor principal del visor 3D.
 */
export function Viewport() {
  const loading = useSceneStore(s => s.loading)
  const error = useSceneStore(s => s.error)
  const hasData = useSceneStore(s => s.data !== null)
  const viewMode = useSceneStore(s => s.trajectoryViewMode)
  const originalWp = useSceneStore(s => s.activePlan?.visualization?.waypoints)
  const optimized = useSceneStore(s => s.optimizedPositions)

  const diff = useMemo(() => {
    if (!originalWp?.length || !optimized?.length) return null
    return computeDiff(originalWp, optimized)
  }, [originalWp, optimized])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive">
        <p className="text-sm font-medium">{error}</p>
      </div>
    )
  }

  if (loading && !hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-2" />
        <p className="text-sm">Loading scene...</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <SceneCanvas />

      {/* Toolbar flotante sobre el canvas */}
      {hasData && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            className="px-2 py-1 text-[11px] font-medium rounded bg-background/80 border border-border 
                       text-foreground/70 hover:text-foreground hover:bg-background transition-colors
                       backdrop-blur-sm cursor-pointer"
            onClick={() => {
              // TODO: fit robot to view
            }}
          >
            Fit Robot
          </button>
        </div>
      )}

      {/* Numerical diff overlay when viewing optimized trajectory */}
      {viewMode === 'optimized' && diff && (
        <div className="absolute bottom-3 left-3 flex items-center gap-3 px-3 py-2 rounded-lg
                        bg-background/85 border border-border backdrop-blur-sm text-[11px]">
          <Move className="h-3.5 w-3.5 text-green-500 shrink-0" />
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">
              <span className="font-mono text-green-500 font-medium">{fmtDelta(diff.avgDelta)}</span>
              {' '}avg Δ
            </span>
            <span className="text-muted-foreground">
              <span className="font-mono text-amber-500 font-medium">{fmtDelta(diff.maxDelta)}</span>
              {' '}max Δ
            </span>
            <span className="text-muted-foreground">
              <span className="font-mono text-foreground font-medium">{diff.movedCount}/{diff.matched}</span>
              {' '}relocated
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
