import { useAnalysisStore } from '@/features/analysis/store'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'
import { dedupeRecommendations, recommendationKey } from '@/shared/contracts/analysis-report'
import { NarrativeSummaryCard } from './NarrativeSummaryCard'
import { RecommendationCard } from './RecommendationCard'
import { VerdictGauge } from './VerdictGauge'
import { TriggeredRules } from './TriggeredRules'
import { MembershipBars } from './MembershipBars'
import { InferenceTrace } from './InferenceTrace'

/** Recommendations — references to existing PlanAdvisor actions (kept from
 *  the pre-tab IntelligentAssessment section; hidden when none). */
function AssessmentRecommendations({ assessment }: { assessment: AssessmentWire }) {
  if (assessment.recommendations.length === 0) return null
  return (
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
  )
}

/**
 * IntelligenceView — the COMPOSED content of the Intelligence tab (spec
 * evaluation-intelligence-tab hierarchy), one focused sub-component per
 * concern, top to bottom:
 *
 *   0. Narrative — NarrativeSummaryCard: intelligible headline + grounded
 *      summary + primary factor chips (intelligible-repair-loop).
 *   1. Verdict     — VerdictGauge: large Quality (0..1) + Risk gauge
 *   2. Why         — TriggeredRules: count + rule chips (id + priority)
 *   3. Evidence    — MembershipBars: one horizontal bar per evidence variable
 *   4. Repair      — RecommendationCard list (report recommendations, deduped
 *      like the Evaluation tab) with uniform Preview/Apply/Undo controls
 *   5. Detail      — InferenceTrace: collapsible inference trace (table)
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
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
        Intelligent Assessment
      </h2>
      <NarrativeSummaryCard assessment={assessment} regions={regions} />
      <VerdictGauge assessment={assessment} />
      <TriggeredRules rules={assessment.triggered_rules} />
      <MembershipBars evidence={assessment.evidence} />
      <AssessmentRecommendations assessment={assessment} />
      {report && recommendations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Repair Recommendations
          </h3>
          <ul data-testid="intelligence-recommendations" className="flex flex-col gap-1.5">
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
      <InferenceTrace trace={assessment.trace} />
    </section>
  )
}
