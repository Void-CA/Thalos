import { apiClient } from '@/shared/api-client'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import type { RepairOptionsWire } from '@/shared/contracts/repair-options'
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

  /**
   * Canonical repair-options endpoint (spec alternatives-panel-react, S4).
   * The deprecated `/plan/analyze/alternatives` route was removed from the
   * client (criteria C1/C2) — the panel consumes ONLY `/plan/repair/options`.
   */
  repairOptions: (): Promise<RepairOptionsWire> =>
    apiClient.post<RepairOptionsWire>('/plan/repair/options', {}).then(r => r.data),

  optimize: () =>
    apiClient.post<OptimizeResponse>('/plan/optimize', {}).then(r => r.data),
}
