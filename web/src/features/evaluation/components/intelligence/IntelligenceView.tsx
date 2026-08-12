import { useAnalysisStore } from '@/features/analysis/store'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'
import { dedupeRecommendations, recommendationKey } from '@/shared/contracts/analysis-report'
import { NarrativeSummaryCard } from './NarrativeSummaryCard'
import { RecommendationCard } from './RecommendationCard'
import { VerdictGauge } from './VerdictGauge'
import { TriggeredRules } from './TriggeredRules'
import { MembershipBars } from './MembershipBars'
import { InferenceTrace } from './InferenceTrace'

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
 * IntelligenceView — the COMPOSED content of the Intelligence tab (spec
 * evaluation-intelligence-tab hierarchy), one focused sub-component per
 * concern, in reading order:
 *
 *   0. Hero       — NarrativeSummaryCard: large verdict headline + grounded
 *      summary + primary factor chips, risk-tinted (intelligible-repair-loop).
 *   1. Verdict    — VerdictGauge: large canonical Score (0–100) + grade + Risk
 *      gauge
 *   2. Evidence   — TriggeredRules: count + rule chips (id + priority), then
 *      MembershipBars: one horizontal bar per evidence variable
 *   3. Repair     — RecommendationCard list (report recommendations, deduped
 *      like the Evaluation tab) with uniform Preview/Apply/Undo controls
 *   4. References — AssessmentRecommendations: the assessment's own list,
 *      de-emphasized (kept from the pre-tab section)
 *   5. Detail     — InferenceTrace: collapsible inference trace, collapsed by
 *      default (table)
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

  return (
    <section
      data-testid="intelligent-assessment"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
        Intelligent Assessment
      </h2>
      <NarrativeSummaryCard assessment={assessment} regions={regions} />
      <VerdictGauge assessment={assessment} report={report} />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/10 p-3.5">
        <TriggeredRules rules={assessment.triggered_rules} />
        <MembershipBars evidence={assessment.evidence} />
      </div>
      {report && recommendations.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="text-sm font-semibold text-foreground">Repair Recommendations</h3>
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
      <AssessmentRecommendations assessment={assessment} />
      <InferenceTrace trace={assessment.trace} />
    </section>
  )
}
