import type { AssessmentWire } from '@/shared/contracts/analysis-report'
import { IntelligenceView } from './intelligence/IntelligenceView'

/**
 * IntelligentAssessment — the "Intelligent Assessment" section of the
 * Evaluation workspace (design "UI — Intelligent Assessment section").
 *
 * Since the tab refactor (evaluation-intelligence-tab) the section is the
 * composed IntelligenceView living in `./intelligence` (VerdictGauge,
 * TriggeredRules, MembershipBars, InferenceTrace). This component is kept as
 * the backward-compatible entry point — it owns NO fuzzy/AI rendering logic;
 * it only forwards the assessment to the composed view. Rendered only when
 * `report.assessment` is present (never mounted with an absent assessment).
 */
export function IntelligentAssessment({ assessment }: { assessment: AssessmentWire }) {
  return <IntelligenceView assessment={assessment} />
}
