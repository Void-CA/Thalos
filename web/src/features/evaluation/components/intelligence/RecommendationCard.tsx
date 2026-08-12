import { useState } from 'react'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
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
 * The apply/undo re-fetch (UI derives from server state) lives in the flow
 * tasks (3.2/3.3) — see `refetch-analysis.ts`.
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
      await planAnalysisApi.undo()
      setApplied(null)
    } catch (err: any) {
      setError(err.message ?? 'Undo failed')
    } finally {
      setUndoing(false)
    }
  }

  return (
    <li
      data-testid="recommendation-card"
      className="flex flex-col gap-1.5 rounded-md border border-border bg-secondary/20 px-2.5 py-2"
    >
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

      {/* Rationale — WHY this remediation exists (region cause, wire-grounded). */}
      {region?.explanation?.cause && (
        <p data-testid="recommendation-rationale" className="text-[11px] font-medium text-foreground">
          {region.explanation.cause}
        </p>
      )}

      {/* Affected segment — where the remediation lands. */}
      {(region || span) && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground" data-testid="recommendation-segment">
          <span>Affected segment</span>
          {region && <span className="font-mono text-foreground">Region {region.id}</span>}
          {span && <span className="font-mono text-foreground">{span}</span>}
        </div>
      )}

      {/* Strategy — how the plan can be repaired. */}
      {(strategy || recommendation.action.impact) && (
        <div className="flex flex-col gap-0.5" data-testid="recommendation-strategy">
          <h4 className="text-[9px] uppercase tracking-wider text-muted-foreground">Strategy</h4>
          {strategy ? (
            <ul className="flex flex-wrap gap-1">
              {strategy.map((s) => (
                <li
                  key={s}
                  className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-foreground"
                >
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[10px] text-foreground">{recommendation.action.impact}</span>
          )}
        </div>
      )}

      {/* Proposed edit — the semantic command, rendered structurally. */}
      {Object.keys(recommendation.edit).length > 0 && (
        <div className="flex flex-col gap-0.5" data-testid="recommendation-edit">
          <h4 className="text-[9px] uppercase tracking-wider text-muted-foreground">Proposed edit</h4>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="font-mono font-semibold text-foreground">{editVariant(recommendation.edit)}</span>
            <span className="font-mono text-muted-foreground">{editParamsSummary(recommendation.edit)}</span>
          </div>
        </div>
      )}

      {applied && (
        <div data-testid="recommendation-applied" className="space-y-1 rounded bg-muted/40 px-2 py-1.5 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded bg-green-600/15 px-1.5 py-0.5 font-semibold uppercase text-green-600">
              <Check className="h-3 w-3" />
              Applied
            </span>
            <span className="text-muted-foreground">Plan</span>
            <span className="font-mono text-foreground">{applied.plan_id}</span>
            <span className="ml-auto text-muted-foreground">
              Health {(applied.health_before * 100).toFixed(0)}% →{' '}
              <span className="font-mono tabular-nums font-semibold text-foreground">
                {(applied.health_after * 100).toFixed(0)}%
              </span>
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="text-[10px] text-destructive bg-destructive-weak rounded px-2 py-1">{error}</div>
      )}

      {preview && (
        <div data-testid="recommendation-preview" className="space-y-1 rounded bg-muted/40 px-2 py-1.5 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Health</span>
            <span className="font-mono tabular-nums">{(preview.health_before * 100).toFixed(0)}%</span>
            <span className="text-muted-foreground">→</span>
            <span
              className={`font-mono tabular-nums font-semibold ${preview.improvement >= 0 ? 'text-green-600' : 'text-red-500'}`}
            >
              {(preview.health_after * 100).toFixed(0)}%
            </span>
            <span className={`text-[10px] ${preview.improvement >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              ({pct(preview.health_before, preview.health_after)})
            </span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              Waypoints {preview.metrics_before.waypoint_count ?? '-'} →{' '}
              {preview.metrics_after.waypoint_count ?? '-'}
            </span>
            <span>
              Continuity:{' '}
              <span className="text-foreground font-mono">{preview.continuity ? 'continuous' : 'broken'}</span>
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
