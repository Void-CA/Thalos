import { useState, useMemo } from 'react'
import { planAnalysisApi } from '../api/plan-analysis-api'
import type { OptimizeResponse } from '../api/plan-analysis.types'
import { useSceneStore } from '@/features/viewport/store'
import type { TrajectoryViewMode } from '@/features/viewport/store'
import { Loader2, Sparkles, Check, X, Minus } from 'lucide-react'

// ── Helpers ──

interface PositionDiff {
  originalCount: number
  optimizedCount: number
  matched: number
  avgDelta: number
  maxDelta: number
  movedCount: number
  deltaArray: number[]
}

function computePositionDiff(
  original: { position: [number, number, number] }[],
  optimized: number[][],
): PositionDiff | null {
  if (!original.length || !optimized.length) return null
  const n = Math.min(original.length, optimized.length)
  const deltas: number[] = []
  for (let i = 0; i < n; i++) {
    const [ox, oy, oz] = original[i].position
    const [tx, ty, tz] = optimized[i]
    const dx = tx - ox, dy = ty - oy, dz = tz - oz
    deltas.push(Math.sqrt(dx * dx + dy * dy + dz * dz))
  }
  if (deltas.length === 0) return null
  return {
    originalCount: original.length,
    optimizedCount: optimized.length,
    matched: n,
    avgDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    maxDelta: Math.max(...deltas),
    movedCount: deltas.filter(d => d > 0.0001).length,
    deltaArray: deltas,
  }
}

function formatDelta(meters: number): string {
  if (meters >= 1) return `${meters.toFixed(3)} m`
  if (meters >= 0.01) return `${(meters * 1000).toFixed(1)} mm`
  return `${(meters * 1000).toFixed(3)} mm`
}

// ── Component ──

/**
 * OptimizationPanel — "Optimize Trajectory" button + report.
 *
 * Shows health score, metric deltas, operator results, and a concrete
 * numerical comparison of how much waypoints actually moved in 3D space.
 */
export function OptimizationPanel() {
  const [optimizing, setOptimizing] = useState(false)
  const [result, setResult] = useState<OptimizeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setOptimizedPositions = useSceneStore(s => s.setOptimizedPositions)
  const trajectoryViewMode = useSceneStore(s => s.trajectoryViewMode)
  const setTrajectoryViewMode = useSceneStore(s => s.setTrajectoryViewMode)
  const originalWaypoints = useSceneStore(s => s.activePlan?.visualization?.waypoints)

  const positionDiff = useMemo(() => {
    if (!result?.optimized_positions || !originalWaypoints?.length) return null
    return computePositionDiff(originalWaypoints, result.optimized_positions)
  }, [result, originalWaypoints])

  const handleOptimize = async () => {
    setOptimizing(true)
    setError(null)
    setResult(null)
    try {
      const res = await planAnalysisApi.optimize()
      setResult(res)
      setOptimizedPositions(res.optimized_positions)
      setTrajectoryViewMode('optimized')
    } catch (err: any) {
      setError(err.message ?? 'Optimization failed')
    } finally {
      setOptimizing(false)
    }
  }

  const switchView = (mode: TrajectoryViewMode) => {
    setTrajectoryViewMode(mode)
  }

  const pct = (before: number, after: number) => {
    if (before === 0) return after === 0 ? '0%' : '+∞'
    const d = ((after - before) / before) * 100
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`
  }

  const operatorDescription = (id: string): string => {
    switch (id) {
      case 'joint_centering': return 'Aleja articulaciones de sus límites'
      case 'adaptive_sampling': return 'Agrega puntos donde hay curvas cerradas'
      case 'nullspace_optimization': return 'Reubica articulaciones sin mover el TCP'
      case 'orientation_relaxation': return 'Relaja ángulos de herramienta demasiado estrictos'
      case 'retime': return 'Reduce velocidad donde excede límites'
      default: return ''
    }
  }

  const deltaClass = (before: number, after: number, higherIsBetter: boolean) => {
    const improved = higherIsBetter ? after > before : after < before
    return improved ? 'text-green-600' : after === before ? 'text-muted-foreground' : 'text-red-500'
  }

  const OperatorIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'applied': return <Check className="h-3.5 w-3.5 text-green-600" />
      case 'rejected': return <X className="h-3.5 w-3.5 text-amber-500" />
      case 'failed': return <Minus className="h-3.5 w-3.5 text-red-500" />
      default: return null
    }
  }

  return (
    <div className="border-t border-border pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Optimization
        </h3>
        {!result && !optimizing && (
          <button
            onClick={handleOptimize}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                       border border-primary-mid bg-primary-weak text-primary
                       hover:bg-primary-weak transition-all cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Optimize Trajectory
          </button>
        )}
      </div>

      {optimizing && (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-xs">Optimizing…</span>
        </div>
      )}

      {error && (
        <div className="text-xs text-destructive bg-destructive-weak border border-destructive-weak rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Health score */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Health</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono tabular-nums">{result.health_before.toFixed(0)}%</span>
              <span className="text-muted-foreground">→</span>
              <span className={`font-mono tabular-nums font-semibold ${deltaClass(result.health_before, result.health_after, true)}`}>
                {result.health_after.toFixed(0)}%
              </span>
              <span className={`text-[10px] ${deltaClass(result.health_before, result.health_after, true)}`}>
                ({pct(result.health_before, result.health_after)})
              </span>
            </div>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <MetricRow
              label="Manipulability"
              before={result.metrics.manipulability_before}
              after={result.metrics.manipulability_after}
              higherIsBetter
            />
            <MetricRow
              label="Joint margin"
              before={result.metrics.joint_margin_before}
              after={result.metrics.joint_margin_after}
              higherIsBetter
            />
            <MetricRow
              label="Max velocity"
              before={result.metrics.max_velocity_before}
              after={result.metrics.max_velocity_after}
              higherIsBetter={false}
            />
            <MetricRow
              label="Segment error"
              before={result.metrics.max_segment_error_before}
              after={result.metrics.max_segment_error_after}
              higherIsBetter={false}
            />
          </div>

          {/* ── Position diff: prueba concreta de que la trayectoria cambió ── */}
          {positionDiff && (
            <div className="bg-muted/40 rounded-lg px-3 py-2 space-y-1">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Position changes
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Waypoints</span>
                  <span className="font-mono tabular-nums">
                    {positionDiff.originalCount}
                    {positionDiff.originalCount !== positionDiff.optimizedCount && (
                      <span className="text-amber-500"> → {positionDiff.optimizedCount}</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Relocated</span>
                  <span className="font-mono tabular-nums">
                    {positionDiff.movedCount}/{positionDiff.matched}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Avg Δ</span>
                  <span className="font-mono tabular-nums text-green-600 font-medium">
                    {formatDelta(positionDiff.avgDelta)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Max Δ</span>
                  <span className={`font-mono tabular-nums font-medium ${
                    positionDiff.maxDelta > 0.01 ? 'text-amber-500' : 'text-green-600'
                  }`}>
                    {formatDelta(positionDiff.maxDelta)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Operators applied */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Operators
            </h4>
            <div className="space-y-0.5">
              {result.operators_applied.map((op, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <OperatorIcon status={op.status} />
                  <span className="font-medium">{op.id.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-muted-foreground">({op.family})</span>
                  <span className="text-[10px] text-muted-foreground ml-1">{operatorDescription(op.id)}</span>
                  <span className={`text-[10px] ml-auto ${
                    op.status === 'applied' ? 'text-green-600' :
                    op.status === 'rejected' ? 'text-amber-500' : 'text-red-500'
                  }`}>
                    {op.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Re-optimize + mutually exclusive view toggle */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleOptimize}
              disabled={optimizing}
              className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
            >
              Optimize again
            </button>

            {/* Mutually exclusive toggle: original vs optimized */}
            <div className="flex rounded-lg border border-border overflow-hidden text-xs">
              <button
                onClick={() => switchView('original')}
                className={`px-2.5 py-1 cursor-pointer transition-colors ${
                  trajectoryViewMode === 'original'
                    ? 'bg-primary text-white font-medium'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                Original
              </button>
              <button
                onClick={() => switchView('optimized')}
                className={`px-2.5 py-1 cursor-pointer transition-colors ${
                  trajectoryViewMode === 'optimized'
                    ? 'bg-primary text-white font-medium'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                Optimized
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, before, after, higherIsBetter }: {
  label: string
  before: number
  after: number
  higherIsBetter: boolean
}) {
  const pct = (b: number, a: number) => {
    if (b === 0) return a === 0 ? '0%' : '+∞'
    return `${((a - b) / b * 100) >= 0 ? '+' : ''}${((a - b) / b * 100).toFixed(1)}%`
  }

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="font-mono tabular-nums">{before.toFixed(4)}</span>
      <span className="text-muted-foreground">→</span>
      <span className={`font-mono tabular-nums font-medium ${deltaClass(before, after, higherIsBetter)}`}>
        {after.toFixed(4)}
      </span>
      <span className={`text-[10px] ${deltaClass(before, after, higherIsBetter)}`}>
        ({pct(before, after)})
      </span>
    </div>
  )
}

function deltaClass(before: number, after: number, higherIsBetter: boolean) {
  const improved = higherIsBetter ? after > before : after < before
  return improved ? 'text-green-600' : after === before ? 'text-muted-foreground' : 'text-red-500'
}
