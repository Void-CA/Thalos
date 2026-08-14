import { useState } from 'react'
import type {
  AnalysisReportWire,
  CandidateRankingWire,
  MetricComparisonWire,
  NoCandidateReasonWire,
  SelectionReasonWire,
  StrategyOutcomeWire,
  StrategyTraceWire,
} from '@/shared/contracts/analysis-report'

/**
 * CandidateAlternatives — the ALTERNATIVE SYNTHESIS → SELECTION layer of the
 * Intelligence tab (spec candidate-alternatives-demo). Rendered ONLY when
 * `report.candidate_ranking` is present; the existing INTELLIGENT ASSESSMENT
 * (level 1, the rest of the tab) is untouched. The visual hierarchy is
 * explicit: ALTERNATIVE SYNTHESIS (comparison table + strategy trace) then
 * SELECTION (a distinct conclusion card — NOT just a highlighted cell).
 *
 * DISPLAY-ONLY: every value comes from the wire verbatim. The section never
 * re-derives risk, cost or selection — the backend Assessor + evaluator are
 * the single authority. The only derivation is the display projection
 * `quality = 1 − risk` (labeled "Assessed quality", matching the VerdictHero
 * pattern — the ranking itself used crisp `1 − Assessment.quality`).
 */

/** Fixed metric-component labels (the evaluator's objective axes). */
const COMPONENT_LABELS: Record<MetricComparisonWire['component'], string> = {
  risk: 'Risk',
  duration: 'Duration',
  manipulability: 'Manipulability',
  length: 'Length',
  cost: 'Cost',
}

/** Humanize a structural skip reason from the wire — never invented text. */
function humanizeSkipReason(reason: NoCandidateReasonWire): string {
  if (reason === 'IkFailed') return 'IK failed'
  if (reason === 'UnsupportedSegment') return 'Unsupported segment'
  return `Invariant violation: ${reason.InvariantViolation.invariant}`
}

/** The strategy outcome from the trace (the authoritative status source), or
 *  undefined when the trace has no row for the strategy. */
function traceOutcome(
  trace: StrategyTraceWire[],
  strategy: CandidateRankingWire['ranked'][number]['strategy'],
): StrategyOutcomeWire | undefined {
  return trace.find((row) => row.strategy === strategy)?.outcome
}

export function CandidateAlternatives({ report }: { report: AnalysisReportWire }) {
  const ranking = report.candidate_ranking
  if (!ranking) return null
  return (
    <section
      data-testid="candidate-alternatives"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
          Candidate Alternatives
        </h2>
        <p
          data-testid="candidate-alternatives-level"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Level 2 · Alternative Synthesis → Level 3 · Selection
        </p>
      </div>
      <ComparisonTable ranking={ranking} planSingularCount={singularCountOf(report)} />
      <StrategyTrace trace={ranking.strategy_trace} />
      <WhyReason reason={ranking.reason} selected={ranking.selected} />
    </section>
  )
}

/** The analyzer's plan-level singular count (`metrics.singular_count`). Direct
 *  IS the analyzed seed program (backend baseline equivalence), so this is the
 *  Direct baseline's count; the wire carries NO per-candidate counts. */
function singularCountOf(report: AnalysisReportWire): number | null {
  const value = report.metrics.singular_count
  return typeof value === 'number' ? value : null
}

// ─── Level 2a · Comparison table ─────────────────────────────────────────────

function ComparisonTable({
  ranking,
  planSingularCount,
}: {
  ranking: CandidateRankingWire
  planSingularCount: number | null
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="candidate-comparison-table">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Comparison · one row per ranked candidate
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                'Strategy',
                'Status',
                'Risk',
                'Assessed quality',
                'Singular',
                'Manipulability',
                'Length',
                'Cost',
                'Selection',
              ].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranking.ranked.map((candidate) => {
              const selected = ranking.selected === candidate.strategy
              const outcome = traceOutcome(ranking.strategy_trace, candidate.strategy)
              return (
                <tr
                  key={candidate.strategy}
                  data-testid="candidate-row"
                  data-selected={selected ? 'true' : 'false'}
                  className={
                    selected
                      ? 'border-b border-border bg-success-weak/40'
                      : 'border-b border-border last:border-b-0'
                  }
                >
                  <td
                    data-testid="candidate-strategy"
                    className="px-3 py-2 text-sm font-medium text-foreground"
                  >
                    {candidate.strategy}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip outcome={outcome} />
                  </td>
                  <td
                    data-testid="candidate-risk"
                    className="px-3 py-2 font-mono text-xs tabular-nums text-foreground"
                  >
                    {candidate.risk.toFixed(4)}
                  </td>
                  <td
                    data-testid="candidate-quality"
                    className="px-3 py-2 font-mono text-xs tabular-nums text-foreground"
                  >
                    {(1 - candidate.risk).toFixed(4)}
                  </td>
                  <td
                    data-testid="candidate-singular"
                    className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground"
                  >
                    {candidate.strategy === 'Direct' && planSingularCount !== null
                      ? String(planSingularCount)
                      : '—'}
                  </td>
                  <td
                    data-testid="candidate-manipulability"
                    className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground"
                  >
                    {candidate.manipulability.toFixed(4)}
                  </td>
                  <td
                    data-testid="candidate-length"
                    className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground"
                  >
                    {candidate.length.toFixed(3)}
                  </td>
                  <td
                    data-testid="candidate-cost"
                    className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground"
                  >
                    {candidate.cost.toFixed(4)}
                  </td>
                  <td
                    data-testid="candidate-selection"
                    className="px-3 py-2 text-xs font-semibold"
                  >
                    {selected ? (
                      <span className="rounded-md border border-border bg-card/70 px-2 py-1 text-[10px] uppercase tracking-wider text-foreground">
                        Selected
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {planSingularCount !== null && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Singularity counts are the analyzer&apos;s plan-level metric (the Direct baseline);
          per-candidate counts are not on the wire.
        </p>
      )}
    </div>
  )
}

/** Generated/Skipped chip for a row's status — sourced from the strategy
 *  trace. A ranked candidate without a trace row defaults to Generated
 *  (ranked ⇒ generated; the trace is the display source when present). */
function StatusChip({ outcome }: { outcome: StrategyOutcomeWire | undefined }) {
  const kind = outcome?.kind ?? 'generated'
  return (
    <span
      data-testid="candidate-status"
      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        kind === 'generated'
          ? 'border-success-mid/40 text-chart-3'
          : 'border-warning-mid/40 text-chart-4'
      }`}
    >
      {kind === 'generated' ? 'Generated' : 'Skipped'}
    </span>
  )
}

// ─── Level 2b · Strategy trace (every strategy, Generated/Skipped + reason) ─

function StrategyTrace({ trace }: { trace: StrategyTraceWire[] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="strategy-trace">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Strategy trace · generated / skipped per strategy
      </h3>
      <div className="flex flex-col gap-1.5">
        {trace.map((entry) => (
          <TraceEntry key={entry.strategy} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function TraceEntry({ entry }: { entry: StrategyTraceWire }) {
  const [expanded, setExpanded] = useState(false)
  if (entry.outcome.kind === 'generated') {
    return (
      <div
        data-testid="strategy-trace-entry"
        className="flex items-center gap-2 rounded-md border border-border/60 bg-secondary/10 px-3 py-1.5"
      >
        <span className="font-mono text-xs font-medium text-foreground">{entry.strategy}</span>
        <span className="rounded-md border border-success-mid/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-chart-3">
          Generated
        </span>
      </div>
    )
  }
  const summary = humanizeSkipReason(entry.outcome.reason ?? 'IkFailed')
  return (
    <div
      data-testid="strategy-trace-entry"
      className="rounded-md border border-border/60 bg-secondary/10 px-3 py-1.5"
    >
      <button
        type="button"
        data-testid="strategy-trace-skip"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="font-mono text-xs font-medium text-foreground">{entry.strategy}</span>
        <span className="rounded-md border border-warning-mid/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-chart-4">
          Skipped
        </span>
        <span className="text-xs text-muted-foreground">({summary})</span>
        <span className="ml-auto text-[10px] text-muted-foreground" aria-hidden>
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      {expanded && (
        <p
          data-testid="strategy-trace-skip-reason"
          className="mt-1.5 border-t border-border/60 pt-1.5 text-xs leading-relaxed text-muted-foreground"
        >
          {entry.strategy} → Skipped ({summary})
        </p>
      )}
    </div>
  )
}

// ─── Level 3 · Selection — a DISTINCT conclusion, derived from the wire ────

function WhyReason({
  reason,
  selected,
}: {
  reason: SelectionReasonWire
  selected: CandidateRankingWire['selected']
}) {
  if (reason.kind === 'no_admissible_candidate') {
    return (
      <div
        data-testid="selection-conclusion"
        className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/10 p-3"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Selection
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          No admissible candidate — {reason.reason}
        </p>
      </div>
    )
  }

  const riskRow = reason.metric_comparison.find((m) => m.component === 'risk')
  return (
    <div
      data-testid="selection-conclusion"
      className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/10 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Selection
        </h3>
        {selected && (
          <span className="rounded-md border border-border bg-card/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground">
            Selected: {selected}
          </span>
        )}
      </div>
      {riskRow && (
        <p data-testid="selection-headline" className="text-sm font-semibold text-foreground">
          {COMPONENT_LABELS[riskRow.component]}: {riskRow.selected_value.toFixed(4)} vs{' '}
          {riskRow.baseline_value.toFixed(4)} (Direct)
        </p>
      )}
      <div
        data-testid="selection-metric-comparison"
        className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-card/50 p-2"
      >
        {reason.metric_comparison.map((m) => (
          <p key={m.component} className="text-xs leading-relaxed text-muted-foreground">
            {COMPONENT_LABELS[m.component]}: {m.selected_value.toFixed(4)} vs{' '}
            {m.baseline_value.toFixed(4)} (Direct)
          </p>
        ))}
      </div>
      {reason.endpoints && (
        <p data-testid="selection-endpoints" className="text-xs text-muted-foreground">
          {reason.endpoints}
        </p>
      )}
      {reason.task && (
        <p data-testid="selection-task" className="text-xs text-muted-foreground">
          {reason.task}
        </p>
      )}
    </div>
  )
}
