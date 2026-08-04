/**
 * Manipulability chart builder — pure function, spec manipulability-chart.
 *
 * Input: canonical AnalysisReportWire (never a hand-built shape — I1).
 * Output: ChartModel. NO ECharts, NO React, NO DOM (O2).
 *
 * Presentation transformations only (I2): projects the yoshikawa series
 * verbatim, colors each waypoint by the severity of the observations anchored
 * there (Error → low, Warning → med, otherwise high — MANIP tokens), and adds
 * the dataZoom slider+inside the spec requires. It never interpolates or
 * recomputes manipulability values.
 */

import type {
  AnalysisReportWire,
  ManipulabilityPointWire,
} from '@/shared/contracts/analysis-report'
import { manipulabilitySeriesOf, waypointOf } from '@/shared/contracts/analysis-report'
import type { ChartModel } from '../types'

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
function manipColorOf(severity: Severity | undefined): string {
  switch (severity) {
    case 'Error':
      return 'manip.low'
    case 'Warning':
      return 'manip.med'
    default:
      return 'manip.high'
  }
}

/** Line chart of per-waypoint yoshikawa manipulability with dataZoom. */
export function manipulabilityBuilder(report: AnalysisReportWire): ChartModel {
  const points = manipulabilitySeriesOf(report)
  if (points.length === 0) {
    return { series: [], xAxis: [], empty: { message: 'No manipulability data available' } }
  }

  const severityByWaypoint = worstSeverityByWaypoint(report)

  const series = {
    name: 'Manipulability',
    type: 'line' as const,
    data: points.map((point: ManipulabilityPointWire) => point.yoshikawa),
    color: 'chart-1',
    smooth: true,
    dataColors: points.map((point) =>
      manipColorOf(severityByWaypoint.get(point.waypoint)),
    ),
  }

  return {
    title: 'Manipulability',
    series: [series],
    xAxis: [{ type: 'value', name: 'Waypoint', min: 0, max: Math.max(0, points.length - 1) }],
    yAxis: [{ type: 'value', name: 'Yoshikawa' }],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ],
    tooltip: { trigger: 'axis' },
  }
}
