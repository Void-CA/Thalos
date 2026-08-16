import { useQuery } from '@tanstack/react-query'
import { EChart, comparisonBuilder } from '@/shared/charts'
import type { AnalysisObservationWire, WireLocation } from '@/shared/contracts/analysis-report'
import { sessionApi } from '../api/session-api'

/**
 * ComparisonTab — plan-vs-execution comparison (S6.3, spec comparison-chart).
 *
 * Purely compositional (P4): the tab fetches the canonical comparison and
 * delegates ALL domain mapping to comparisonBuilder — the chart, the global
 * readout and the observations are projections of `SessionComparisonResponse`
 * fields, verbatim. The builder never recalculates RMSE (I5), and the readout
 * renders `metrics` values as returned by the backend (same pattern as the
 * summary/statistics readouts).
 *
 * Observations are rendered structurally (kind / severity / location — the
 * same wire fields the Advisor projects); no interpretation by text matching.
 */

interface ComparisonTabProps {
  sessionId: number
}

export function ComparisonTab({ sessionId }: ComparisonTabProps) {
  const comparison = useQuery({
    queryKey: ['sessions', sessionId, 'comparison'],
    queryFn: () => sessionApi.comparison(sessionId),
  })

  if (comparison.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading comparison…</p>
  }

  if (comparison.error) {
    return (
      <p className="text-sm text-destructive">
        {comparison.error instanceof Error
          ? comparison.error.message
          : 'Could not load comparison'}
      </p>
    )
  }

  const data = comparison.data
  if (!data) return null

  const model = comparisonBuilder(data)

  return (
    <div className="space-y-3">
      <div className="h-80 w-full">
        <EChart model={model} />
      </div>

      {data.aligned_pair_count > 0 && (
        <section
          aria-label="Comparison readout"
          className="rounded-md border border-border p-3 space-y-2"
        >
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Metrics
          </h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Global RMSE</dt>
            <dd className="text-foreground text-right">{data.metrics.global_rmse}</dd>
            <dt className="text-muted-foreground">Max error</dt>
            <dd className="text-foreground text-right">{data.metrics.global_max_error}</dd>
            <dt className="text-muted-foreground">Avg error</dt>
            <dd className="text-foreground text-right">{data.metrics.global_avg_error}</dd>
            <dt className="text-muted-foreground">Max tracking error</dt>
            <dd className="text-foreground text-right">{data.metrics.max_tracking_error ?? '—'}</dd>
            <dt className="text-muted-foreground">Avg tracking error</dt>
            <dd className="text-foreground text-right">{data.metrics.avg_tracking_error ?? '—'}</dd>
            <dt className="text-muted-foreground">Aligned pairs</dt>
            <dd className="text-foreground text-right">{data.aligned_pair_count}</dd>
          </dl>
        </section>
      )}

      <section aria-label="Comparison observations" className="rounded-md border border-border p-3 space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Observations
        </h4>
        {data.observations.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.observations.map((observation) => (
              <ObservationRow key={observation.id} observation={observation} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ObservationRow({ observation }: { observation: AnalysisObservationWire }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-2.5 py-1.5">
      <SeverityBadge severity={observation.severity} />
      <span className="text-xs font-medium text-foreground">{titleCase(observation.kind)}</span>
      <span className="ml-auto text-[10px] font-mono text-muted-foreground">
        {locationLabel(observation.location)}
      </span>
    </li>
  )
}

/** Severity badge — structural rendering of the canonical severity field. */
function SeverityBadge({ severity }: { severity: AnalysisObservationWire['severity'] }) {
  const styles: Record<AnalysisObservationWire['severity'], string> = {
    Error: 'bg-destructive-weak text-destructive border-destructive-mid',
    Warning: 'bg-warning-weak text-chart-4 border-warning-mid',
    Info: 'bg-muted text-muted-foreground border-border',
  }
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${styles[severity]}`}>
      {severity}
    </span>
  )
}

/** Location — Waypoint anchor for waypoint observations, else the variant kind. */
function locationLabel(location: WireLocation): string {
  if ('Waypoint' in location) return `wp${location.Waypoint}`
  const [kind] = Object.keys(location)
  return kind ?? 'Unknown'
}

/** Machine-readable kind → display label. Cosmetic only. */
function titleCase(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
