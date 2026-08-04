import { apiClient } from '@/shared/api-client'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import type { OptimizeResponse } from './plan-analysis.types'

/**
 * domain-areas S4: `/plan/analyze` returns the canonical AnalysisReport
 * projection (observations/actions/metrics/summary). The compatibility layer
 * was removed — components and stores consume the wire shape directly
 * (ADR: ui-as-domain-projection).
 */
export const planAnalysisApi = {
  analyze: (planId?: string): Promise<AnalysisReportWire> =>
    apiClient
      .post<AnalysisReportWire>('/plan/analyze', { plan_id: planId ?? null })
      .then(r => r.data),

  alternatives: () =>
    apiClient.post<{ original_score: number; alternatives: unknown[] }>('/plan/analyze/alternatives', {}).then(r => r.data),

  optimize: () =>
    apiClient.post<OptimizeResponse>('/plan/optimize', {}).then(r => r.data),
}
