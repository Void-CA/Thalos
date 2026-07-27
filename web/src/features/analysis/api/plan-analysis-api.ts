import { apiClient } from '@/shared/api-client'
import type { PlanAnalysisResponse, OptimizeResponse } from './plan-analysis.types'

export const planAnalysisApi = {
  analyze: (planId?: string) =>
    apiClient.post<PlanAnalysisResponse>('/plan/analyze', { plan_id: planId ?? null }).then(r => r.data),

  alternatives: () =>
    apiClient.post<{ original_score: number; alternatives: unknown[] }>('/plan/analyze/alternatives', {}).then(r => r.data),

  optimize: () =>
    apiClient.post<OptimizeResponse>('/plan/optimize', {}).then(r => r.data),
}
