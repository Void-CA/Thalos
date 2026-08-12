import { useRecommendation } from '@/features/analysis/recommendation-model'
import { useSceneStore } from '@/features/viewport/store'
import { sceneService } from '@/features/viewport/services/scene.service'
import type { AnalysisReportWire, RecommendationWire } from '@/shared/contracts/analysis-report'
import { Check, Eye, Loader2, Play, RotateCcw } from 'lucide-react'

/**
 * RecommendationRow — PRESENTATION of ONE recommendation in the Evaluation tab
 * (spec advisor-projection "RecommendationRow Projection"). The Preview/Apply/
 * Undo behavior and all derived data live in the shared `useRecommendation`
 * model (web/src/features/analysis/recommendation-model.ts) — this row only:
 *   - renders the uniform controls (kind, unavailable badge, Preview/Apply/
 *     Undo) driven by the model's `state` + `handlers`;
 *   - layers the 3D scene overlay (SINGLE owner): on preview success it writes
 *     the preview positions to the scene store and switches the trajectory
 *     view mode; on apply/undo success it refreshes the scene from the backend
 *     so the viewport shows the write-back.
 * The scene overlay is a presentation concern — the model exposes the preview
 * data and the row wires it to the viewport.
 */
export function RecommendationRow({
  recommendation,
  report,
}: {
  recommendation: RecommendationWire
  report: AnalysisReportWire
}) {
  const { state, handlers, derived } = useRecommendation(recommendation, report)
  const setPreviewPositions = useSceneStore(s => s.setPreviewPositions)
  const setTrajectoryViewMode = useSceneStore(s => s.setTrajectoryViewMode)
  const applyScene = useSceneStore(s => s.applyScene)

  const { previewing, applying, undoing, error, unavailable, canUndo } = state
  const { kindLabel, applied, preview } = derived

  const handlePreview = async () => {
    const res = await handlers.handlePreview()
    if (res) {
      // 3D overlay — same mechanism as OptimizationPanel: write the positions
      // to the store and switch the trajectory view mode.
      setPreviewPositions(res.waypoints)
      setTrajectoryViewMode('preview')
    }
  }

  const handleApply = async () => {
    const res = await handlers.handleApply()
    if (res) {
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
    }
  }

  const handleUndo = async () => {
    const res = await handlers.handleUndo()
    if (res) {
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
    }
  }

  return (
    <li data-testid="recommendation-row" className="flex flex-col gap-1.5 rounded-md border border-border bg-secondary/20 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">{kindLabel}</span>
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
            disabled={undoing || !canUndo}
            title={
              !canUndo
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
            <span className="font-mono text-foreground">{applied.planId}</span>
            <span className="ml-auto text-muted-foreground">
              Health {applied.beforePct} →{' '}
              <span className="font-mono tabular-nums font-semibold text-foreground">
                {applied.afterPct}
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
            <span className="font-mono tabular-nums">{preview.beforePct}</span>
            <span className="text-muted-foreground">→</span>
            <span className={`font-mono tabular-nums font-semibold ${preview.improved ? 'text-green-600' : 'text-red-500'}`}>
              {preview.afterPct}
            </span>
            <span className={`text-[10px] ${preview.improved ? 'text-green-600' : 'text-red-500'}`}>
              ({preview.deltaPct})
            </span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              Waypoints {preview.waypointsBefore} → {preview.waypointsAfter}
            </span>
            <span>
              Continuity: <span className="text-foreground font-mono">{preview.continuity}</span>
            </span>
          </div>
        </div>
      )}
    </li>
  )
}
