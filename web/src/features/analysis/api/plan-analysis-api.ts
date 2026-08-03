import { apiClient } from '@/shared/api-client'
import { toLegacyAnalysis } from '@/shared/contracts/plan-analysis-compat'
import type { AnalysisReportWire } from '@/shared/contracts/plan-analysis-compat'
import type { PlanAnalysisResponse, OptimizeResponse } from './plan-analysis.types'

/**
 * PR 7b: `/plan/analyze` returns the canonical AnalysisReport projection
 * (observations/actions/metrics/summary). The pre-cambio-A UI consumes the
 * legacy contract, so the response is adapted HERE — the single call site of
 * the compatibility layer. Components and stores never see the wire shape.
 * TODO(change-A): remove compatibility layer — return `AnalysisReportWire`
 * directly when the new UI ships.
 */
export const planAnalysisApi = {
  analyze: (planId?: string): Promise<PlanAnalysisResponse> =>
    apiClient
      .post<AnalysisReportWire>('/plan/analyze', { plan_id: planId ?? null })
      .then(r => toLegacyAnalysis(r.data)),

  alternatives: () =>
    apiClient.post<{ original_score: number; alternatives: unknown[] }>('/plan/analyze/alternatives', {}).then(r => r.data),

  optimize: () =>
    apiClient.post<OptimizeResponse>('/plan/optimize', {}).then(r => r.data),
}
