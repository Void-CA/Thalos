/**
 * Jacobian determinant chart builder — pure function, spec determinant-chart.
 *
 * Mirror of `manipulabilityBuilder` for the determinant of J·Jᵀ. Same pipeline
 * (canonical AnalysisReportWire → ChartModel), same presentation rules:
 * projects the per-waypoint `det_jtj` series as -log10 (hotfix
 * manipulability-logscale — a linear axis flattens the real
 * multi-order-of-magnitude variation against zero), colors each waypoint by
 * the severity of the observations anchored there, adds the dataZoom slider+
 * inside, and marks the warning threshold as a reference line (markLine).
 *
 * I2: the builder NEVER recomputes the determinant — it only projects what the
 * backend shipped (the log transform is a pure presentation change). Points
 * without `det_jtj` (older payloads) are dropped; if none carry it, the
 * builder returns an explicit empty state (I3 additive).
 */

import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import { manipulabilitySeriesOf, waypointOf } from '@/shared/contracts/analysis-report'
import type { ChartModel } from '../types'
import { YOSHIKAWA_THRESHOLD } from './manipulability'
import { toLogScale } from './log-scale'

/**
 * det(J·Jᵀ) warning threshold. Mathematically identical to the backend's
 * low-manipulability threshold: det(J·Jᵀ) = ∏σᵢ² = (∏σᵢ)² = yoshikawa², so the
 * same condition "yoshikawa < 0.3" reads "det_jtj < 0.09" (analysis/mod.rs).
 */
export const DET_JTJ_THRESHOLD = YOSHIKAWA_THRESHOLD ** 2

/** DET_JTJ_THRESHOLD converted to the -log10 y axis: -log10(0.09) ≈ 1.046. */
export const LOG_DET_JTJ_THRESHOLD = toLogScale(DET_JTJ_THRESHOLD)

type Severity = 'Error' | 'Warning' | 'Info'

/** Worst observation severity per waypoint (Error > Warning > Info). */
function worstSeverityByWaypoint(report: AnalysisReportWire): Map<number, Severity> {
  const worst = new Map<number, Severity>()
  for (const observation of report.observations) {
    const waypoint = waypointOf(observation)
    if (waypoint === null) continue
    const current = worst.get(waypoint)
    if (current === 'Error') continue
    if (observation.severity === 'Error' || current === undefined) {
      worst.set(waypoint, observation.severity)
    } else if (observation.severity === 'Warning' && current === 'Info') {
      worst.set(waypoint, 'Warning')
    }
  }
  return worst
}

/** Observation severity → MANIP color token (presentation mapping). */
function detColorOf(severity: Severity | undefined): string {
  switch (severity) {
    case 'Error':
      return 'manip.low'
    case 'Warning':
      return 'manip.med'
    default:
      return 'manip.high'
  }
}

/** Line chart of per-waypoint det(J·Jᵀ) with dataZoom + threshold markLine. */
export function determinantBuilder(report: AnalysisReportWire): ChartModel {
  const points = manipulabilitySeriesOf(report).filter(
    (point): point is { waypoint: number; yoshikawa: number; det_jtj: number } =>
      point.det_jtj !== undefined,
  )
  if (points.length === 0) {
    return { series: [], xAxis: [], empty: { message: 'No determinant data available' } }
  }

  const severityByWaypoint = worstSeverityByWaypoint(report)

  const series = {
    name: '-log10(Det(J·Jᵀ))',
    type: 'line' as const,
    data: points.map((point) => toLogScale(point.det_jtj)),
    color: 'chart-2',
    smooth: false,
    dataColors: points.map((point) => detColorOf(severityByWaypoint.get(point.waypoint))),
  }

  return {
    title: 'Jacobian determinant (-log10)',
    series: [series],
    xAxis: [{ type: 'value', name: 'Waypoint', min: 0, max: Math.max(0, points.length - 1) }],
    yAxis: [{ type: 'value', name: '-log10(Det(J·Jᵀ))', scale: true }],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ],
    tooltip: { trigger: 'axis' },
    markLine: [
      {
        yAxis: LOG_DET_JTJ_THRESHOLD,
        label: `Threshold ${DET_JTJ_THRESHOLD} → ${LOG_DET_JTJ_THRESHOLD.toFixed(3)}`,
        color: 'severity.warning',
      },
    ],
  }
}
