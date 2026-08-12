import { useAnalysisStore } from '@/features/analysis/store'
import type { AssessmentWire } from '@/shared/contracts/analysis-report'
import { IntelligenceView } from './intelligence/IntelligenceView'

/**
 * IntelligentAssessment — the "Intelligent Assessment" section of the
 * Evaluation workspace (design "UI — Intelligent Assessment section").
 *
 * Since the tab refactor (evaluation-intelligence-tab) the section is the
 * composed IntelligenceView living in `./intelligence` (NarrativeSummaryCard,
 * VerdictGauge, TriggeredRules, MembershipBars, InferenceTrace,
 * RecommendationCard list). This component is kept as the backward-compatible
 * entry point — it owns NO fuzzy/AI rendering logic; it only forwards the
 * assessment + the report's problem regions to the composed view. Rendered
 * only when `report.assessment` is present (never mounted with an absent
 * assessment).
 */
export function IntelligentAssessment({ assessment }: { assessment: AssessmentWire }) {
  // NOTE: select the stable `report` reference, never `report?.problem_regions
  // ?? []` — a fresh array identity per evaluation trips Zustand's
  // useSyncExternalStore infinite-loop guard (see analysis store doc).
  const report = useAnalysisStore((s) => s.report)
  const regions = report?.problem_regions ?? []
  return <IntelligenceView assessment={assessment} regions={regions} />
}
