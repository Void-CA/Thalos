import { useState } from 'react'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import { refetchAnalysis } from '@/features/analysis/api/refetch-analysis'
import type { ApplyResponse, PreviewResponse } from '@/features/analysis/api/plan-analysis.types'
import { useSceneStore } from '@/features/viewport/store'
import { sceneService } from '@/features/viewport/services/scene.service'
import type { RecommendationWire } from '@/shared/contracts/analysis-report'
import { Check, Eye, Loader2, Play, RotateCcw } from 'lucide-react'

/**
 * RecommendationRow — uniform projection of ONE recommendation (spec
 * advisor-projection "RecommendationRow Projection").
 *
 * Contracts:
 * - UNIFORM CONTROLS: Preview/Apply/Undo identical for EVERY
 *   recommendation — the `action.kind` never changes the controls offered
 *   (no match_strategy nor defaultStrategies, zero string dispatch).
 * - PR3 (read-only): Preview is ACTIVE — simulates the edit on the backend
 *   (never mutates the runtime) and shows the 3D overlay through the same
 *   mechanism as OptimizationPanel (`setPreviewPositions` + `trajectoryViewMode`).
 * - PR4 (write-back): Apply is ACTIVE for edits `available` — applies the
 *   edit on the backend (replace_active_plan, feature-flagged) and refreshes
 *   the scene so the viewport shows the resulting active plan.
 *   D8: an `unavailable` edit is never applied — disabled button.
 * - PR5 (undo O(1)): Undo is ACTIVE after applying THIS row — the backend
 *   pops the last command and applies its stored inverse (no replay);
 *   the row returns to its previous state and the scene refreshes.
 * - intelligible-repair-loop (3.2/3.3): after Apply/Undo the row also
 *   re-fetches the canonical report (`refetchAnalysis`) so verdict,
 *   narrative, regions and metrics derive from the server state.
 */
export function RecommendationRow({ recommendation }: { recommendation: RecommendationWire }) {
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<ApplyResponse | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setPreviewPositions = useSceneStore(s => s.setPreviewPositions)
  const setTrajectoryViewMode = useSceneStore(s => s.setTrajectoryViewMode)
  const applyScene = useSceneStore(s => s.applyScene)

  const unavailable = recommendation.status === 'unavailable'

  const handlePreview = async () => {
    setPreviewing(true)
    setError(null)
    try {
      const res = await planAnalysisApi.preview(recommendation.id)
      setPreview(res)
      // 3D overlay — same pattern as OptimizationPanel: write the positions to
      // the store and switch the trajectory view mode.
      setPreviewPositions(res.waypoints)
      setTrajectoryViewMode('preview')
    } catch (err: any) {
      setError(err.message ?? 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const handleApply = async () => {
    setApplying(true)
    setError(null)
    try {
      const res = await planAnalysisApi.apply(recommendation.id)
      setApplied(res)
      // UI reflects the ACTIVE plan: refresh the scene from the backend (same
      // pattern as use-scene-loader) — the viewport renders the write-back.
      const snapshot = await sceneService.loadScene()
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
      // intelligible-repair-loop (3.2): the analysis and its derivatives
      // (verdict, narrative, regions, metrics) must also reflect the APPLIED
      // plan — re-fetch of the canonical report (UI derives from server state).
      await refetchAnalysis()
    } catch (err: any) {
      setError(err.message ?? 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  const handleUndo = async () => {
    setUndoing(true)
    setError(null)
    try {
      // PR5 undo O(1): the backend pops the last applied command and applies its
      // stored inverse (no replay). This row stops showing "Applied".
      await planAnalysisApi.undo()
      setApplied(null)
      // The scene reflects the RESTORED plan: refresh from the backend.
      const snapshot = await sceneService.loadScene()
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
      // intelligible-repair-loop (3.3): the analysis reflects the RESTORED plan.
      await refetchAnalysis()
    } catch (err: any) {
      setError(err.message ?? 'Undo failed')
    } finally {
      setUndoing(false)
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
            onClick={handleApply}
            disabled={applying || unavailable}
            title={unavailable ? 'Edit unavailable (D8) — cannot apply' : 'Apply to the active plan'}
            className="inline-flex items-center gap-1 rounded-md border border-primary-mid bg-primary-weak px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary-weak transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Apply
          </button>
          <button
            onClick={handleUndo}
            disabled={undoing || applied === null}
            title={
              applied === null
                ? 'No applied command to undo'
                : 'Undo the last applied command (O(1) via stored inverse)'
            }
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {undoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Undo
          </button>
        </span>
      </div>

      {applied && (
        <div className="space-y-1 rounded bg-muted/40 px-2 py-1.5 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded bg-green-600/15 px-1.5 py-0.5 font-semibold uppercase text-green-600">
              <Check className="h-3 w-3" />
              Applied
            </span>
            <span className="text-muted-foreground">Plan</span>
            <span className="font-mono text-foreground">{applied.plan_id}</span>
            <span className="ml-auto text-muted-foreground">
              Health {applied.health_before.toFixed(0)}% →{' '}
              <span className="font-mono tabular-nums font-semibold text-foreground">
                {applied.health_after.toFixed(0)}%
              </span>
            </span>
          </div>
        </div>
      )}

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
