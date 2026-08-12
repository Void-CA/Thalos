import { useState } from 'react'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import { refetchAnalysis } from '@/features/analysis/api/refetch-analysis'
import type {
  ApplyResponse,
  PreviewResponse,
} from '@/features/analysis/api/plan-analysis.types'
import type {
  AnalysisReportWire,
  RecommendationWire,
} from '@/shared/contracts/analysis-report'
import { recommendationRegionId, waypointOf } from '@/shared/contracts/analysis-report'
import { Check, Eye, Loader2, Play, RotateCcw } from 'lucide-react'

/**
 * RecommendationCard (intelligible-repair-loop 2.2) — ONE recommendation in
 * the Intelligence tab. The card answers "what can we do", never "what is the
 * verdict": rationale (region cause), affected segment (region id + waypoint
 * span), strategy (region recommended strategies / action impact fallback) and
 * the proposed `ProgramEdit` rendered structurally. It never feeds the
 * narrative summary (separation rule).
 *
 * Controls mirror RecommendationRow's uniform Preview/Apply/Undo (spec
 * advisor-projection): the card reuses the row's panel presentation but does
 * NOT duplicate the 3D scene overlay — Preview here only renders the Actual →
 * Proposed → Improvement + continuity panel. D8: an `unavailable` edit never
 * applies — the Apply button is disabled.
 *
 * Apply/Undo re-fetch the analysis through `refetchAnalysis` (UI derives from
 * server state): the displayed assessment/narrative/metrics always match the
 * persisted program, never a PreviewResponse or a local delta. `history_length`
 * is SERVER-RETURNED state (ApplyResponse/UndoResponse) — Undo renders only
 * while the latest server value is > 0; the card never ++/-- locally.
 */
export function RecommendationCard({
  recommendation,
  report,
}: {
  recommendation: RecommendationWire
  report: AnalysisReportWire
}) {
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<ApplyResponse | null>(null)
  const [undoing, setUndoing] = useState(false)
  /** Undo-history size as LAST RETURNED by the server (Apply/UndoResponse).
   *  Null until the first flow response; Undo renders only when > 0. */
  const [historyLength, setHistoryLength] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unavailable = recommendation.status === 'unavailable'

  const regionId = recommendationRegionId(recommendation, report)
  const region =
    regionId !== null ? (report.problem_regions ?? []).find((r) => r.id === regionId) ?? null : null
  const observation = report.observations.find(
    (o) => o.id === recommendation.action.target_observation,
  )
  const waypoint = observation ? waypointOf(observation) : null
  const span = region
    ? region.waypoint_end > region.waypoint_start
      ? `wp${region.waypoint_start}\u2013wp${region.waypoint_end}`
      : `wp${region.waypoint_start}`
    : waypoint !== null
      ? `wp${waypoint}`
      : null
  const strategies = region?.explanation?.recommended_strategies
  const strategy = strategies && strategies.length > 0 ? strategies : null

  const handlePreview = async () => {
    setPreviewing(true)
    setError(null)
    try {
      const res = await planAnalysisApi.preview(recommendation.id)
      setPreview(res)
      // NOTE: no scene overlay here — the 3D preview mechanism belongs to
      // RecommendationRow (single owner); this card renders the panel only.
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
      setHistoryLength(res.history_length)
      // The displayed assessment/narrative/metrics MUST match the APPLIED
      // program — re-fetch the canonical report (never build from preview).
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
      const res = await planAnalysisApi.undo()
      setApplied(null)
      setHistoryLength(res.history_length)
      // Display restores the PREVIOUS assessment — re-fetch the report.
      await refetchAnalysis()
    } catch (err: any) {
      setError(err.message ?? 'Undo failed')
    } finally {
      setUndoing(false)
    }
  }

  const appliedImproved =
    applied !== null && applied.health_after >= applied.health_before

  return (
    <li
      data-testid="recommendation-card"
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-secondary/20 p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{titleCase(recommendation.action.kind)}</h3>
        {unavailable && (
          <span className="rounded-md border border-warning-mid bg-warning-weak px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-chart-4">
            unavailable
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary-mid bg-primary-weak px-3 py-1.5 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary-strong/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            Preview
          </button>
          <button
            onClick={handleApply}
            disabled={applying || unavailable}
            title={unavailable ? 'Edit unavailable (D8) — cannot apply' : 'Apply to the active plan'}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary-mid bg-primary-weak px-3 py-1.5 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary-strong/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Apply
          </button>
          <button
            onClick={handleUndo}
            disabled={undoing || historyLength === null || historyLength <= 0}
            title={
              historyLength === null || historyLength <= 0
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
      {Object.keys(recommendation.edit).length > 0 && (
        <div className="flex flex-col gap-1" data-testid="recommendation-edit">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proposed edit</h4>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-mono font-semibold text-foreground">{editVariant(recommendation.edit)}</span>
            <span className="font-mono text-muted-foreground">{editParamsSummary(recommendation.edit)}</span>
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
            <span className="font-mono text-xs text-foreground">{applied.plan_id}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm tabular-nums">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Health</span>
            <span className="font-mono text-foreground">{(applied.health_before * 100).toFixed(0)}%</span>
            <span className="text-muted-foreground">→</span>
            <span className={`font-mono font-semibold ${appliedImproved ? 'text-chart-3' : 'text-destructive'}`}>
              {(applied.health_after * 100).toFixed(0)}%
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${appliedImproved ? 'bg-chart-3/15 text-chart-3' : 'bg-destructive-weak text-destructive'}`}
            >
              {appliedImproved ? 'improved' : 'regressed'}
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
            <span className="font-mono text-foreground">{(preview.health_before * 100).toFixed(0)}%</span>
            <span className="text-muted-foreground">→</span>
            <span
              className={`font-mono font-semibold ${preview.improvement >= 0 ? 'text-chart-3' : 'text-destructive'}`}
            >
              {(preview.health_after * 100).toFixed(0)}%
            </span>
            <span className={`text-xs font-semibold ${preview.improvement >= 0 ? 'text-chart-3' : 'text-destructive'}`}>
              ({pct(preview.health_before, preview.health_after)})
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Waypoints {preview.metrics_before.waypoint_count ?? '-'} →{' '}
              {preview.metrics_after.waypoint_count ?? '-'}
            </span>
            <span>
              Continuity:{' '}
              <span className="font-mono text-foreground">{preview.continuity ? 'continuous' : 'broken'}</span>
            </span>
          </div>
        </div>
      )}
    </li>
  )
}

/** Externally-tagged ProgramEdit variant key (e.g. "ReplaceSegment"). */
function editVariant(edit: Record<string, unknown>): string {
  return Object.keys(edit)[0] ?? ''
}

/** Compact structured summary of the edit's parameters (mono detail). Tolerant
 *  of legacy/partial payloads — missing fields are simply omitted. */
function editParamsSummary(edit: Record<string, unknown>): string {
  const variant = editVariant(edit)
  const params = (edit[variant] ?? {}) as Record<string, unknown>
  const length = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  switch (variant) {
    case 'ReplaceSegment':
      return `index ${params.index} \u00b7 ${length(params.replacement)} replacement(s)`
    case 'InsertSegments':
      return `at ${params.at} \u00b7 ${length(params.segments)} segment(s)`
    case 'RemoveSegments':
      return `at ${params.at} \u00b7 count ${params.count}`
    case 'SplitMove':
      return `index ${params.index}`
    case 'MergeMoves':
      return `first ${params.first} \u00b7 second ${params.second}`
    case 'MoveWaypoint':
      return `segment_index ${params.segment_index ?? params.waypoint}`
    default:
      return variant
  }
}

/** Machine-readable kind → display label (cosmetic only — interpretation
 *  never branches on this string). */
function titleCase(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Signed percentage change between two health values. */
function pct(before: number, after: number): string {
  if (before === 0) return after === 0 ? '0%' : '+∞'
  return `${((after - before) / before) * 100 >= 0 ? '+' : ''}${(((after - before) / before) * 100).toFixed(1)}%`
}
