import type {
  AnalysisReportWire,
  AnalysisObservationWire,
  AnalysisActionWire,
  WireLocation,
} from '@/shared/contracts/analysis-report'
import { severityCounts } from '@/shared/contracts/analysis-report'
import { ChartBar } from 'lucide-react'

/**
 * AdvisorSection — pure projection of the canonical `AnalysisReportWire`
 * (design D3, spec advisor-projection).
 *
 * INVARIANTS (user criterion S4b):
 * - Consumes ONLY the `report` prop — zero imports of planning stores, zero
 *   backend hooks, zero domain-operation triggers.
 * - Interpretation is STRUCTURAL: Observation.kind / severity / actions /
 *   summary (I3) — never by matching message text (no message.includes).
 * - API is `<AdvisorSection report={report} />` — no legacy props
 *   (findings/recommendations/health_score/flags).
 *
 * Data flow: AnalysisReport → Advisor → UI (unidirectional projection).
 */
export interface AdvisorSectionProps {
  report: AnalysisReportWire | null
}

export function AdvisorSection({ report }: AdvisorSectionProps) {
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
        <ChartBar className="h-6 w-6 mb-2 opacity-30" />
        <p className="text-xs">No analysis available</p>
      </div>
    )
  }

  const counts = severityCounts(report)

  return (
    <div className="flex flex-col gap-3">
      {/* Header — summary projection (score, grade, severity distribution). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-sm font-bold tabular-nums">
          Score: {report.summary.score}
        </span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Grade: {report.summary.grade}
        </span>
        <span className="flex items-center gap-3 text-[10px] font-medium tabular-nums text-muted-foreground">
          <span>Errors: {counts.error}</span>
          <span>Warnings: {counts.warning}</span>
          <span>Info: {counts.info}</span>
        </span>
      </div>

      {/* Observations — kind + severity badge + location (I3 structural). */}
      <section>
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Observations
        </h3>
        {report.observations.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {report.observations.map(observation => (
              <ObservationRow key={observation.id} observation={observation} />
            ))}
          </ul>
        )}
      </section>

      {/* Actions — kind + target observation (I5: targets by id). */}
      <section>
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Actions
        </h3>
        {report.actions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {report.actions.map(action => (
              <ActionRow key={action.id} action={action} />
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
      <span className="text-xs font-medium text-foreground">
        {titleCase(observation.kind)}
      </span>
      <span className="ml-auto text-[10px] font-mono text-muted-foreground">
        {locationLabel(observation.location)}
      </span>
    </li>
  )
}

function ActionRow({ action }: { action: AnalysisActionWire }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-2.5 py-1.5">
      <span className="text-xs font-medium text-foreground">{titleCase(action.kind)}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">
        target observation {action.target_observation}
      </span>
    </li>
  )
}

/** Severity badge — pure structural rendering of the severity field (I3). */
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

/** Location — Waypoint anchor for waypoint observations, else the location
 *  variant kind (Timestamp, Joint, …). Structural, not text-matched. */
function locationLabel(location: WireLocation): string {
  if ('Waypoint' in location) return `wp${location.Waypoint}`
  const [kind] = Object.keys(location)
  return kind ?? 'Unknown'
}

/** Machine-readable kind → display label (camelCase / snake_case → Title Case).
 *  Cosmetic only — interpretation never branches on this string. */
function titleCase(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}
