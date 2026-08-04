/**
 * Metrics dashboard builders — pure functions, spec metrics-dashboard.
 *
 * Input: canonical AnalysisReportWire. Output: ChartModel. NO ECharts, NO
 * React, NO DOM (O2).
 *
 * Presentation transformations only (I2): the severity distribution comes from
 * `summary.severity_distribution` VERBATIM — never re-aggregated from
 * observations — and the score is projected as-is (no rounding, no
 * reinterpretation). All numeric values trace to fields on AnalysisReportWire
 * (I1).
 */

import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import type { ChartModel } from '../types'

/** The severity levels the dashboard projects, in display order. */
export const SEVERITY_LEVELS = ['Error', 'Warning', 'Info'] as const

/** Severity level → color token (presentation mapping). */
function severityColor(level: string): string {
  switch (level) {
    case 'Error':
      return 'severity.critical'
    case 'Warning':
      return 'severity.warning'
    default:
      return 'severity.good'
  }
}

/**
 * Score readout bar (0–100) from `summary.score`. The score is the quality
 * index × 100 as the backend projects it; the builder displays it verbatim
 * (I2 — no reformatting, no re-scoring).
 */
export function scoreBreakdownBuilder(report: AnalysisReportWire): ChartModel {
  const score = report.summary.score
  return {
    title: `Score: ${score}`,
    series: [
      {
        name: 'Score',
        type: 'bar',
        data: [score],
        color: 'chart-1',
      },
    ],
    xAxis: [{ type: 'category', categories: ['Score'] }],
    yAxis: [{ type: 'value', min: 0, max: 100, name: 'Score' }],
    tooltip: { trigger: 'item' },
  }
}

/**
 * Severity distribution bar chart from `summary.severity_distribution` — the
 * canonical aggregate, consumed verbatim (I2: the builder must never recompute
 * it from `observations[]`).
 */
export function metricsDashboardBuilder(report: AnalysisReportWire): ChartModel {
  const metricsEmpty = Object.keys(report.metrics ?? {}).length === 0
  if (metricsEmpty) {
    return { series: [], xAxis: [], empty: { message: 'Metrics not available' } }
  }

  const distribution = report.summary.severity_distribution ?? {}
  const data = SEVERITY_LEVELS.map((level) => distribution[level] ?? 0)

  return {
    title: `Score: ${report.summary.score}`,
    series: [
      {
        name: 'Observations',
        type: 'bar',
        data,
        color: 'chart-2',
        dataColors: SEVERITY_LEVELS.map(severityColor),
      },
    ],
    xAxis: [{ type: 'category', categories: [...SEVERITY_LEVELS] }],
    yAxis: [{ type: 'value', name: 'Observations' }],
    tooltip: { trigger: 'axis' },
  }
}
