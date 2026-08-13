import { useAnalysisStore } from '@/features/analysis/store'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'
import { buildNarrativeSummary, buildWhy } from '@/shared/analysis/narrative-summary'
import { VerdictHero } from './VerdictHero'
import { FactorRows } from './FactorRows'
import { TechnicalDetails } from './TechnicalDetails'

/**
 * IntelligenceView — the pure INTELLIGENT ASSESSMENT view (the ADVISOR lives
 * in its own Repairs tab). Same semantics as the frozen system. Reading order:
 *
 *   0. Verdict — VerdictHero: the AI verdict is the protagonist (risk word +
 *      crisp risk · quality), with the analyzer's health clearly secondary.
 *   1. Why     — FactorRows: the assessment factors (label | value | reading).
 *   2. Why?    — the elevation story (explanation FIRST, when a localized
 *      singular event elevated the verdict).
 *   3. Audit   — TechnicalDetails: the inference trace, ALWAYS visible (rules
 *      with degrees + derived facts, evidence) — no collapsible.
 *
 * The semantic layers are therefore explicit across the workspace tabs:
 *   ANALYSIS (Evaluation tab) → INTELLIGENT ASSESSMENT (this view) → ADVISOR
 *   (Repairs tab). All copy is English.
 */
export function IntelligenceView({
  assessment,
  regions,
}: {
  assessment: AssessmentWire
  regions: ProblemRegionWire[]
}) {
  const report = useAnalysisStore((s) => s.report)
  const narrative = buildNarrativeSummary(assessment, regions)
  const why = buildWhy(assessment)
  const riskWord = assessment.risk.charAt(0).toUpperCase() + assessment.risk.slice(1)

  return (
    <section
      data-testid="intelligent-assessment"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
        Intelligent Assessment
      </h2>
      <VerdictHero
        assessment={assessment}
        report={report}
        summary={narrative.summary}
        whyLine={why?.line ?? null}
      />
      <FactorRows evidence={assessment.evidence} primaryFactors={narrative.primary_factors} />

      {/* WHY — explanation first, audit second (the elevation story) */}
      {why && (
        <div className="flex flex-col gap-2" data-testid="intelligence-why">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Why {riskWord}?
          </h3>
          <p className="text-sm leading-relaxed text-foreground">{why.detail}</p>
        </div>
      )}

      {/* Inference trace — the audit, always visible */}
      <TechnicalDetails
        rules={assessment.triggered_rules}
        evidence={assessment.evidence}
        trace={assessment.trace}
      />
    </section>
  )
}
