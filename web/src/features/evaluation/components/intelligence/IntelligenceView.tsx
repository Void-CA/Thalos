import { useAnalysisStore } from '@/features/analysis/store'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'
import { dedupeRecommendations, recommendationKey } from '@/shared/contracts/analysis-report'
import { buildNarrativeSummary } from '@/shared/analysis/narrative-summary'
import { VerdictHero } from './VerdictHero'
import { FactorRows } from './FactorRows'
import { RecommendationCard } from './RecommendationCard'
import { TechnicalDetails } from './TechnicalDetails'

/** References — the assessment's own recommendation list (kept from the
 *  pre-tab IntelligentAssessment section, asserted by its tests). Deliberately
 *  de-emphasized: the actionable Repair Recommendation cards are the primary
 *  list; this is a compact, muted footer of references. Hidden when none. */
function AssessmentRecommendations({ assessment }: { assessment: AssessmentWire }) {
  if (assessment.recommendations.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Recommendations
      </h3>
      <ul className="flex flex-col gap-1" data-testid="assessment-recommendations">
        {assessment.recommendations.map((recommendation, index) => (
          <li
            key={`${recommendation.action_kind}-${index}`}
            data-testid="assessment-recommendation"
            className="text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">{recommendation.action_kind}</span>
            {recommendation.region_id !== undefined && (
              <span> (region {recommendation.region_id})</span>
            )}
            <span> — {recommendation.rationale}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * IntelligenceView — the COMPOSED content of the Intelligence tab (structural
 * UX redesign: decision first, technical detail collapsed away). Reading
 * order, one focused sub-component per concern:
 *
 *   0. Verdict     — VerdictHero: ONE risk-tinted band (canonical score +
 *      grade pill + risk badge + a single human summary line). The only
 *      verdict number on the tab.
 *   1. Why         — FactorRows: structured top factors (icon | label |
 *      value | severity bar | reading), selected from the narrative's primary
 *      factors so the hero one-liner and the rows always agree.
 *   2. Action      — RecommendationCard list (report recommendations, deduped
 *      like the Evaluation tab) with uniform Preview/Apply/Undo controls.
 *   3. Detail      — TechnicalDetails: ONE collapsible (closed by default)
 *      owning TriggeredRules + MembershipBars + InferenceTrace.
 *   4. References  — AssessmentRecommendations: the assessment's own list,
 *      de-emphasized (kept from the pre-tab section).
 *
 * EvaluationWorkspace mounts this view with the assessment + the report's
 * problem regions and accumulates NO fuzzy/AI rendering logic of its own. The
 * recommendation cards derive from the canonical report in the analysis store
 * (the same source the Evaluation tab projects). All copy is English.
 */
export function IntelligenceView({
  assessment,
  regions,
}: {
  assessment: AssessmentWire
  regions: ProblemRegionWire[]
}) {
  const report = useAnalysisStore((s) => s.report)
  const recommendations = report?.recommendations ?? []
  const narrative = buildNarrativeSummary(assessment, regions)

  return (
    <section
      data-testid="intelligent-assessment"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
        Intelligent Assessment
      </h2>
      <VerdictHero assessment={assessment} report={report} summary={narrative.summary} />
      <FactorRows evidence={assessment.evidence} primaryFactors={narrative.primary_factors} />
      {report && recommendations.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="text-sm font-semibold text-foreground">Action · Repair recommendations</h3>
          <ul data-testid="intelligence-recommendations" className="flex flex-col gap-2.5">
            {dedupeRecommendations(recommendations).map((recommendation) => (
              <RecommendationCard
                key={recommendationKey(recommendation)}
                recommendation={recommendation}
                report={report}
              />
            ))}
          </ul>
        </div>
      )}
      <TechnicalDetails
        rules={assessment.triggered_rules}
        evidence={assessment.evidence}
        trace={assessment.trace}
      />
      <AssessmentRecommendations assessment={assessment} />
    </section>
  )
}
