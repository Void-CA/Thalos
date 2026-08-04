/**
 * Comparison chart builder — pure function, spec comparison-chart.
 *
 * Input: canonical `SessionComparisonWire` from GET /sessions/{id}/comparison
 * (never a hand-built plan/execution pair — I1). Output: ChartModel. NO
 * ECharts, NO React, NO DOM (O2).
 *
 * Invariant I5 (the core contract): the builder NEVER recalculates RMSE, max
 * error or any `ComparisonMetrics` field. The wire carries no raw samples —
 * every number rendered here is projected VERBATIM from `response.metrics`.
 * The per-joint RMSE bar series is `metrics.per_joint.rmse` as-is, and the
 * global RMSE reference line (markLine) is `metrics.global_rmse` as-is.
 *
 * Empty state derives from the DOMAIN: `aligned_pair_count = 0` means the
 * backend aligned no plan/execution pairs (spec "Empty comparison") — the
 * builder surfaces the explicit message and the component renders it.
 */

import type { SessionComparisonWire } from '@/features/sessions/api/session-api'
import type { ChartModel } from '../types'

/**
 * Maps the canonical comparison to a per-joint RMSE bar chart with the global
 * RMSE reference line. No comparison value is computed or re-derived here.
 */
export function comparisonBuilder(response: SessionComparisonWire): ChartModel {
  const { metrics, aligned_pair_count } = response

  if (aligned_pair_count === 0) {
    return { series: [], xAxis: [], empty: { message: 'No comparable data' } }
  }

  const perJointRmse = metrics.per_joint.rmse

  return {
    title: 'RMSE per joint',
    series: [
      {
        name: 'RMSE (rad)',
        type: 'bar',
        data: perJointRmse,
        color: 'chart-1',
      },
    ],
    xAxis: [
      {
        type: 'category',
        categories: perJointRmse.map((_, index) => `Joint ${index + 1}`),
      },
    ],
    yAxis: [{ type: 'value', name: 'RMSE (rad)' }],
    tooltip: { trigger: 'axis' },
    // Global RMSE reference line — the canonical global value projected as-is.
    markLine: [{ yAxis: metrics.global_rmse, label: `Global RMSE ${metrics.global_rmse.toFixed(4)}` }],
  }
}
