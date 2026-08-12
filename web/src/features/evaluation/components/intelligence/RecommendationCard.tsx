import { useRecommendation } from '@/features/analysis/recommendation-model'
import type {
  AnalysisReportWire,
  RecommendationWire,
} from '@/shared/contracts/analysis-report'
import { Check, Eye, Loader2, Play, RotateCcw } from 'lucide-react'

/**
 * RecommendationCard (intelligible-repair-loop 2.2) — PRESENTATION of ONE
 * recommendation in the Intelligence tab. The Preview/Apply/Undo behavior and
 * all derived data live in the shared `useRecommendation` model
 * (web/src/features/analysis/recommendation-model.ts) — this card only
 * renders the layout. The card answers "what can we do", never "what is the
 * verdict": rationale (region cause), affected segment (region id + waypoint
 * span), strategy (region recommended strategies / action impact fallback) and
 * the proposed `ProgramEdit` rendered structurally. It never feeds the
 * narrative summary (separation rule).
 *
 * Unlike RecommendationRow this card deliberately has NO 3D scene overlay —
 * the viewport preview mechanism has a single owner (the row). `history_length`
 * is SERVER-RETURNED state owned by the model; Undo renders only while the
 * latest server value is > 0 (never local ++/--).
 */
export function RecommendationCard({
  recommendation,
  report,
}: {
  recommendation: RecommendationWire
  report: AnalysisReportWire
}) {
  const { state, handlers, derived } = useRecommendation(recommendation, report)

  const { previewing, applying, undoing, error, unavailable, canUndo } = state
  const { kindLabel, region, span, strategy, edit, applied, preview } = derived

  return (
    <li
      data-testid="recommendation-card"
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-secondary/20 p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{kindLabel}</h3>
        {unavailable && (
          <span className="rounded-md border border-warning-mid bg-warning-weak px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-chart-4">
            unavailable
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={handlers.handlePreview}
            disabled={previewing}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary-mid bg-primary-weak px-3 py-1.5 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary-strong/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            Preview
          </button>
          <button
            onClick={handlers.handleApply}
            disabled={applying || unavailable}
            title={unavailable ? 'Edit unavailable (D8) — cannot apply' : 'Apply to the active plan'}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary-mid bg-primary-weak px-3 py-1.5 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary-strong/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Apply
          </button>
          <button
            onClick={handlers.handleUndo}
            disabled={undoing || !canUndo}
            title={
              !canUndo
                ? 'No applied command to undo'
                : 'Undo the last applied command (O(1) via stored inverse)'
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Undo
          </button>
        </span>
      </div>

      {/* Rationale — WHY this remediation exists (region cause, wire-grounded). */}
      {region?.explanation?.cause && (
        <p data-testid="recommendation-rationale" className="text-sm leading-relaxed text-foreground">
          {region.explanation.cause}
        </p>
      )}

      {/* Affected segment — where the remediation lands. */}
      {(region || span) && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          data-testid="recommendation-segment"
        >
          <span className="uppercase tracking-wide">Affected segment</span>
          {region && (
            <span className="rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-foreground">
              Region {region.id}
            </span>
          )}
          {span && (
            <span className="rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-foreground">{span}</span>
          )}
        </div>
      )}

      {/* Strategy — how the plan can be repaired. */}
      {(strategy || recommendation.action.impact) && (
        <div className="flex flex-col gap-1" data-testid="recommendation-strategy">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strategy</h4>
          {strategy ? (
            <ul className="flex flex-wrap gap-1.5">
              {strategy.map((s) => (
                <li
                  key={s}
                  className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                >
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-foreground">{recommendation.action.impact}</span>
          )}
        </div>
      )}

      {/* Proposed edit — the semantic command, rendered structurally. */}
      {edit && (
        <div className="flex flex-col gap-1" data-testid="recommendation-edit">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proposed edit</h4>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-mono font-semibold text-foreground">{edit.variant}</span>
            <span className="font-mono text-muted-foreground">{edit.params}</span>
          </div>
        </div>
      )}

      {applied && (
        <div
          data-testid="recommendation-applied"
          className="rounded-lg border border-success-mid/60 bg-success-weak px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-chart-3/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-chart-3">
              <Check className="h-3.5 w-3.5" />
              Applied
            </span>
            <span className="text-xs text-muted-foreground">Plan</span>
            <span className="font-mono text-xs text-foreground">{applied.planId}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm tabular-nums">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Health</span>
            <span className="font-mono text-foreground">{applied.beforePct}</span>
            <span className="text-muted-foreground">→</span>
            <span className={`font-mono font-semibold ${applied.improved ? 'text-chart-3' : 'text-destructive'}`}>
              {applied.afterPct}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${applied.improved ? 'bg-chart-3/15 text-chart-3' : 'bg-destructive-weak text-destructive'}`}
            >
              {applied.improved ? 'improved' : 'regressed'}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive-weak px-3 py-1.5 text-xs text-destructive">{error}</div>
      )}

      {preview && (
        <div
          data-testid="recommendation-preview"
          className="rounded-lg border border-border bg-secondary/30 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Health</span>
            <span className="font-mono text-foreground">{preview.beforePct}</span>
            <span className="text-muted-foreground">→</span>
            <span
              className={`font-mono font-semibold ${preview.improved ? 'text-chart-3' : 'text-destructive'}`}
            >
              {preview.afterPct}
            </span>
            <span className={`text-xs font-semibold ${preview.improved ? 'text-chart-3' : 'text-destructive'}`}>
              ({preview.deltaPct})
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Waypoints {preview.waypointsBefore} → {preview.waypointsAfter}
            </span>
            <span>
              Continuity:{' '}
              <span className="font-mono text-foreground">{preview.continuity}</span>
            </span>
          </div>
        </div>
      )}
    </li>
  )
}
