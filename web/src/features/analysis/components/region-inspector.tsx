import { useAnalysisStore, useSelectedRegion } from '../store'
import { X } from 'lucide-react'

/**
 * RegionInspector — read-only contextual detail panel for the selected
 * problem region (cause, metrics, impact, location).
 *
 * PR6 6.5: the per-strategy repair buttons (legacy repair-sessions flow with
 * string strategy dispatch — match_strategy) were REMOVED. Zero buttons per
 * strategy: `RecommendationRow` (planning workspace) is the only projection of
 * recommendations and owns preview/apply/undo. This panel stays as the
 * drill-down detail view (selectRegion → RegionInspector).
 */
export function RegionInspector() {
  const region = useSelectedRegion()
  const selectRegion = useAnalysisStore(s => s.selectRegion)

  if (!region) return null

  const wpRange = region.waypoint_end > region.waypoint_start
    ? `wp${region.waypoint_start}–wp${region.waypoint_end}`
    : `wp${region.waypoint_start}`

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Region Details</h3>
        <button onClick={() => selectRegion(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cause */}
      {region.explanation?.cause && (
        <p className="text-sm font-semibold text-foreground">{region.explanation.cause}</p>
      )}

      {/* Metrics */}
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

      {/* Impact */}
      {region.explanation?.consequence && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Impact</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{region.explanation.consequence}</p>
        </div>
      )}

      {/* Location */}
      <div>
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Location</h4>
        <span className="text-xs font-mono text-primary bg-primary-weak px-2 py-0.5 rounded">{wpRange}</span>
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
