import { useAnalysisStore, useSelectedRegion } from '../store'
import {
  manipulabilitySeriesOf,
  regionShareOfPlan,
} from '@/shared/contracts/analysis-report'
import type { ManipulabilityPointWire } from '@/shared/contracts/analysis-report'
import { X } from 'lucide-react'

/** Aggregated Yoshikawa manipulability over a waypoint span. */
export interface ManipulabilityStats {
  count: number
  /** Fraction of the region's waypoints that carry a measured value. */
  coverage: number
  average: number
  min: number
  /** Mean of the per-point `relative_manipulability` scores (0–1), computed
   *  ONLY from points that carry the field — older payloads omit it and the
   *  UI never fabricates a value (I2). `null` when no point in the span
   *  carries it (design "relative_manipulability", additive wire field). */
  relativeAverage: number | null
}

/** Aggregated Jacobian determinant det(J·Jᵀ) over a waypoint span. */
export interface DeterminantStats {
  count: number
  average: number
  min: number
}

/**
 * Manipulability (Yoshikawa) stats over the region's waypoint span — a
 * JACOBIAN property (det(J·Jᵀ)) derived from the canonical
 * `manipulability_series` (I2: the UI never recomputes it, it aggregates the
 * backend's per-waypoint projection). Excludes out-of-range points.
 */
export function manipulabilityStatsInRange(
  series: ManipulabilityPointWire[],
  start: number,
  end: number,
): ManipulabilityStats | null {
  const covered = series.filter((p) => p.waypoint >= start && p.waypoint <= end)
  if (covered.length === 0) return null
  const values = covered.map((p) => p.yoshikawa)
  const relativeValues = covered
    .map((p) => p.relative_manipulability)
    .filter((v): v is number => typeof v === 'number')
  const totalWaypoints = end - start + 1
  return {
    count: covered.length,
    coverage: covered.length / Math.max(totalWaypoints, 1),
    average: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
    relativeAverage:
      relativeValues.length > 0
        ? relativeValues.reduce((a, b) => a + b, 0) / relativeValues.length
        : null,
  }
}

/**
 * det(J·Jᵀ) stats over the region's waypoint span, computed ONLY from points
 * that carry `det_jtj` (older payloads omit it — those points are skipped).
 */
export function determinantStatsInRange(
  series: ManipulabilityPointWire[],
  start: number,
  end: number,
): DeterminantStats | null {
  const covered = series.filter(
    (p) => p.det_jtj !== undefined && p.waypoint >= start && p.waypoint <= end,
  )
  if (covered.length === 0) return null
  const values = covered.map((p) => p.det_jtj as number)
  return {
    count: covered.length,
    average: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
  }
}

/**
 * RegionInspector — read-only contextual detail panel for the selected
 * problem region (cause, metrics, impact, location).
 *
 * PR6 6.5: the per-strategy repair buttons (legacy repair-sessions flow with
 * string strategy dispatch — match_strategy) were REMOVED. Zero buttons per
 * strategy: `RecommendationRow` (planning workspace) is the only projection of
 * recommendations and owns preview/apply/undo. This panel stays as the
 * drill-down detail view (selectRegion → RegionInspector).
 *
 * Evaluation hotfix CDD: enriched with what happened AND why — jacobian
 * manipulability (Yoshikawa, det(J·Jᵀ)) over the region span and the concrete
 * cause/consequence. Recommended strategies are NOT shown (the user does not
 * use them in this view); confidence remains.
 */
export function RegionInspector() {
  const region = useSelectedRegion()
  const report = useAnalysisStore((s) => s.report)
  const selectRegion = useAnalysisStore((s) => s.selectRegion)

  if (!region) return null

  const wpRange = region.waypoint_end > region.waypoint_start
    ? `wp${region.waypoint_start}–wp${region.waypoint_end}`
    : `wp${region.waypoint_start}`

  // Region derives from the report, so when `region` is set the report is too —
  // default the series to [] defensively for the typechecker.
  const series = report ? manipulabilitySeriesOf(report) : []
  const manipulability = manipulabilityStatsInRange(
    series,
    region.waypoint_start,
    region.waypoint_end,
  )
  const determinant = determinantStatsInRange(
    series,
    region.waypoint_start,
    region.waypoint_end,
  )
  const share = regionShareOfPlan(region, series, report?.metrics ?? {})

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Region Details</h3>
        <button onClick={() => selectRegion(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cause — WHAT happened, stated by the backend explanation. */}
      {region.explanation?.cause && (
        <p className="text-sm font-semibold text-foreground">{region.explanation.cause}</p>
      )}

      {/* Singular-value metrics (min/max/avg of the analyzed quantity). */}
      {region.metrics && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Metrics</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {region.metrics.average_value != null && (
              <MetricCard label="Average" value={fmt(region.metrics.average_value)} />
            )}
            {region.metrics.min_value != null && (
              <MetricCard label="Min" value={fmt(region.metrics.min_value)} />
            )}
            {region.metrics.max_value != null && (
              <MetricCard label="Max" value={fmt(region.metrics.max_value)} />
            )}
          </div>
        </div>
      )}

      {/* Manipulability — the JACOBIAN property that led to the problem
          (Yoshikawa index = det(J·Jᵀ), lower ⇒ closer to singularity). */}
      <div>
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Manipulability (Jacobian)
        </h4>
        {manipulability ? (
          <>
            <p className="text-[10px] text-muted-foreground mb-1.5">
              Yoshikawa index = det(J·Jᵀ) — lower means closer to singularity.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <MetricCard label="Average" value={fmt(manipulability.average)} />
              <MetricCard label="Min" value={fmt(manipulability.min)} />
              <MetricCard
                label="Coverage"
                value={`${manipulability.count} of ${region.waypoint_count} analyzed`}
              />
            </div>
            {manipulability.relativeAverage != null && (
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                <MetricCard
                  label="Relative avg"
                  value={fmtPct(manipulability.relativeAverage)}
                />
              </div>
            )}
            {determinant && (
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                <MetricCard label="det(J·Jᵀ) avg" value={fmt(determinant.average)} />
                <MetricCard label="det(J·Jᵀ) min" value={fmt(determinant.min)} />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            No manipulability data for this region.
          </p>
        )}
      </div>

      {/* Impact — why it matters. */}
      {region.explanation?.consequence && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Impact</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{region.explanation.consequence}</p>
        </div>
      )}

      {/* Location + confidence. */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Location</h4>
          <span className="text-xs font-mono text-primary bg-primary-weak px-2 py-0.5 rounded">{wpRange}</span>
          {share.percentOfPlan !== null && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {share.percentOfPlan.toFixed(1)}% of the plan
              {share.durationSecs !== null ? ` · ${formatDuration(share.durationSecs)}` : ''}
            </p>
          )}
        </div>
        {region.explanation?.confidence != null && (
          <span className="text-[10px] text-muted-foreground">
            {Math.round(region.explanation.confidence * 100)}% confidence
          </span>
        )}
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-secondary/20 rounded-md px-2.5 py-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-sm font-mono font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  )
}

function fmt(val: number): string {
  if (val === 0) return '0'
  const abs = Math.abs(val)
  if (abs >= 0.001) return val.toFixed(4)
  if (abs >= 1e-6) return val.toFixed(6)
  return val.toExponential(2)
}

/** Percentile score (0–1) rendered as an integer percentage. */
function fmtPct(val: number): string {
  return `${Math.round(val * 100)}%`
}

/** Compact duration label: seconds, or minutes + seconds past 60s. */
function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}m ${s}s`
}
