import { useState } from 'react'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import type { PreviewResponse } from '@/features/analysis/api/plan-analysis.types'
import { useSceneStore } from '@/features/viewport/store'
import type { RecommendationWire } from '@/shared/contracts/analysis-report'
import { Eye, Loader2, Play, RotateCcw } from 'lucide-react'

/**
 * RecommendationRow — proyección uniforme de UNA recomendación (spec
 * advisor-projection "RecommendationRow Projection").
 *
 * Contratos:
 * - CONTROLES UNIFORMES: Preview/Apply/Undo idénticos para TODA
 *   recomendación — el `action.kind` jamás cambia los controles ofrecidos
 *   (no hay match_strategy ni defaultStrategies, cero dispatch por strings).
 * - PR3 (read-only): Preview está ACTIVO — simula la edición en el backend
 *   (nunca muta el runtime) y muestra el overlay 3D con el mismo mecanismo
 *   que OptimizationPanel (`setPreviewPositions` + `trajectoryViewMode`).
 *   Apply/Undo llegan en PR4/PR5 — los botones existen pero deshabilitados.
 * - D8: un edit `unavailable` se muestra con su badge; nunca se aplica.
 */
export function RecommendationRow({ recommendation }: { recommendation: RecommendationWire }) {
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setPreviewPositions = useSceneStore(s => s.setPreviewPositions)
  const setTrajectoryViewMode = useSceneStore(s => s.setTrajectoryViewMode)

  const unavailable = recommendation.status === 'unavailable'

  const handlePreview = async () => {
    setPreviewing(true)
    setError(null)
    try {
      const res = await planAnalysisApi.preview(recommendation.id)
      setPreview(res)
      // Overlay 3D — mismo patrón que OptimizationPanel: escribir las
      // posiciones en el store y conmutar la vista de trayectoria.
      setPreviewPositions(res.waypoints)
      setTrajectoryViewMode('preview')
    } catch (err: any) {
      setError(err.message ?? 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const pct = (before: number, after: number) => {
    if (before === 0) return after === 0 ? '0%' : '+∞'
    return `${((after - before) / before) * 100 >= 0 ? '+' : ''}${(((after - before) / before) * 100).toFixed(1)}%`
  }

  return (
    <li data-testid="recommendation-row" className="flex flex-col gap-1.5 rounded-md border border-border bg-secondary/20 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">{titleCase(recommendation.action.kind)}</span>
        {unavailable && (
          <span className="rounded border border-warning-mid bg-warning-weak px-1.5 py-0.5 text-[9px] font-semibold uppercase text-chart-4">
            unavailable
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="inline-flex items-center gap-1 rounded-md border border-primary-mid bg-primary-weak px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary-weak transition-colors cursor-pointer disabled:opacity-50"
          >
            {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
            Preview
          </button>
          <button
            disabled
            title="Apply lands in PR4"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground disabled:cursor-not-allowed"
          >
            <Play className="h-3 w-3" />
            Apply
          </button>
          <button
            disabled
            title="Undo lands in PR5"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground disabled:cursor-not-allowed"
          >
            <RotateCcw className="h-3 w-3" />
            Undo
          </button>
        </span>
      </div>

      {error && (
        <div className="text-[10px] text-destructive bg-destructive-weak rounded px-2 py-1">{error}</div>
      )}

      {preview && (
        <div className="space-y-1 rounded bg-muted/40 px-2 py-1.5 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Health</span>
            <span className="font-mono tabular-nums">{preview.health_before.toFixed(0)}%</span>
            <span className="text-muted-foreground">→</span>
            <span className={`font-mono tabular-nums font-semibold ${preview.improvement >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {preview.health_after.toFixed(0)}%
            </span>
            <span className={`text-[10px] ${preview.improvement >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              ({pct(preview.health_before, preview.health_after)})
            </span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              Waypoints {preview.metrics_before.waypoint_count ?? '-'} → {preview.metrics_after.waypoint_count ?? '-'}
            </span>
            <span>
              Continuity: <span className="text-foreground font-mono">{preview.continuity ? 'continuous' : 'broken'}</span>
            </span>
          </div>
        </div>
      )}
    </li>
  )
}

/** Machine-readable kind → display label (cosmetic only — interpretation
 *  never branches on this string). */
function titleCase(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}
