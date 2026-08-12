import { useAnalysisStore } from '@/features/analysis/store'
import { planAnalysisApi } from './plan-analysis-api'

/**
 * intelligible-repair-loop (3.2/3.3) — shared apply/undo re-fetch handler:
 * "UI derives from server state".
 *
 * After Apply/Undo the displayed assessment, narrative, recommendations and
 * metrics MUST reflect the persisted program — never a local delta. This
 * re-fetches the canonical analysis report and replaces the one in the store,
 * so every derived view (Intelligence tab narrative + cards, Evaluation tab
 * regions/charts) re-renders from the new server state.
 *
 * `history_length` is NEVER incremented/decremented locally: it is read from
 * the server `ApplyResponse` / `UndoResponse` (see the RecommendationCard
 * flow); Undo renders only while the latest server value is > 0.
 */
export async function refetchAnalysis(): Promise<void> {
  const report = await planAnalysisApi.analyze()
  useAnalysisStore.getState().setAnalysis(report)
}
