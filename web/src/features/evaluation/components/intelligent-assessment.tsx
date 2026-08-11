import { useState } from 'react'
import type { AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * IntelligentAssessment — the "Intelligent Assessment" section of the
 * Evaluation workspace (design "UI — Intelligent Assessment section").
 *
 * Renders the risk/quality verdict of `report.assessment` (thalos-intelligence)
 * with evidence chips, triggered rules, PlanAdvisor-grounded recommendations
 * and a collapsible inference trace (collapsed by default). All copy is
 * English. The section is only rendered when `assessment` is present — this
 * component is never mounted with an absent assessment.
 */

/** Color-coded risk badge tones (green/yellow/orange/red). */
const RISK_TONES: Record<AssessmentWire['risk'], string> = {
  low: 'bg-success-weak text-chart-3',
  medium: 'bg-warning-weak text-chart-4',
  high: 'bg-warning-weak text-chart-5',
  critical: 'bg-destructive-weak text-destructive',
}

export function IntelligentAssessment({ assessment }: { assessment: AssessmentWire }) {
  const [traceOpen, setTraceOpen] = useState(false)

  return (
    <section
      data-testid="intelligent-assessment"
      className="mt-4 flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Intelligent Assessment
        </h2>
        <span className="text-[10px] font-mono text-muted-foreground">
          Quality Score <span className="text-foreground font-semibold">{assessment.quality.toFixed(2)}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Risk Level</span>
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${RISK_TONES[assessment.risk]}`}
        >
          {assessment.risk}
        </span>
      </div>

      {/* Evidence — derived inputs + rule evidence, as key-value chips. */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">Evidence</h3>
        <div className="flex flex-wrap gap-1.5" data-testid="assessment-evidence">
          {Object.entries(assessment.evidence).map(([key, value]) => (
            <span
              key={key}
              data-testid="assessment-evidence-chip"
              className="rounded border border-border bg-secondary/10 px-2 py-0.5 text-[10px] font-mono tabular-nums"
            >
              {key}: {value.toFixed(3)}
            </span>
          ))}
        </div>
      </div>

      {/* Triggered rules, in firing order. */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">Triggered Rules</h3>
        <ul className="flex flex-wrap gap-1.5" data-testid="assessment-triggered-rules">
          {assessment.triggered_rules.map((rule) => (
            <li
              key={rule.id}
              data-testid="assessment-rule"
              className="rounded border border-border bg-secondary/10 px-2 py-0.5 text-[10px] font-mono"
            >
              {rule.id}
              <span className="text-muted-foreground"> · {rule.category}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Recommendations — references to existing PlanAdvisor actions. */}
      {assessment.recommendations.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">Recommendations</h3>
          <ul className="flex flex-col gap-1" data-testid="assessment-recommendations">
            {assessment.recommendations.map((recommendation, index) => (
              <li key={`${recommendation.action_kind}-${index}`} data-testid="assessment-recommendation" className="text-[11px]">
                <span className="font-semibold text-foreground">{recommendation.action_kind}</span>
                {recommendation.region_id !== undefined && (
                  <span className="text-muted-foreground"> (region {recommendation.region_id})</span>
                )}
                <span className="text-muted-foreground"> — {recommendation.rationale}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Collapsible inference trace (collapsed by default). */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          data-testid="assessment-trace-toggle"
          aria-expanded={traceOpen}
          onClick={() => setTraceOpen((open) => !open)}
          className="inline-flex w-fit items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary hover:underline cursor-pointer"
        >
          {traceOpen ? 'Hide' : 'Show'} Inference Trace
        </button>
        {traceOpen && (
          <div data-testid="assessment-trace" className="overflow-x-auto">
            <table className="w-full border-collapse text-[10px] font-mono">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="border-b border-border px-2 py-1">#</th>
                  <th className="border-b border-border px-2 py-1">Rule</th>
                  <th className="border-b border-border px-2 py-1">Priority</th>
                  <th className="border-b border-border px-2 py-1">Bindings</th>
                  <th className="border-b border-border px-2 py-1">Derived</th>
                </tr>
              </thead>
              <tbody>
                {assessment.trace.map((entry, index) => (
                  <tr key={`${entry.rule_id}-${index}`} data-testid="assessment-trace-entry">
                    <td className="border-b border-border px-2 py-1 text-muted-foreground">{index + 1}</td>
                    <td className="border-b border-border px-2 py-1">{entry.rule_id}</td>
                    <td className="border-b border-border px-2 py-1">{entry.priority}</td>
                    <td className="border-b border-border px-2 py-1">
                      {Object.entries(entry.bindings)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(', ')}
                    </td>
                    <td className="border-b border-border px-2 py-1">
                      {Object.entries(entry.derived_output)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
