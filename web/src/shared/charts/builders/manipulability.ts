/**
 * Manipulability chart builder — pure function, spec manipulability-chart.
 *
 * Input: canonical AnalysisReportWire (never a hand-built shape — I1).
 * Output: ChartModel. NO ECharts, NO React, NO DOM (O2).
 *
 * Presentation transformations only (I2): projects the yoshikawa series on its
 * NATURAL linear scale (hotfix manipulability-linear — an experimental,
 * reversible switch away from the -log10 axis; scale:true keeps the real
 * dynamic range visible instead of flattening it against zero), colors each
 * waypoint by the severity of the observations anchored there (Error → low,
 * Warning → med, otherwise high — MANIP tokens), fills the area under the line
 * (hotfix area-charts — the threshold reference line reads against a filled
 * region, not a hairline), and adds the dataZoom slider+inside the spec
 * requires. It never interpolates or recomputes manipulability values.
 */

import type {
  AnalysisReportWire,
  ManipulabilityPointWire,
} from '@/shared/contracts/analysis-report'
import { manipulabilitySeriesOf, waypointOf } from '@/shared/contracts/analysis-report'
import type { AxisConfig, ChartModel } from '../types'
import { toLogScale } from './log-scale'

type Severity = 'Error' | 'Warning' | 'Info'

/**
 * Low-manipulability warning threshold — mirrors the backend's
 * `manip_threshold = 0.3` (thalos-planning/src/analysis/mod.rs:475): an
 * average yoshikawa below it emits a LowManipulability warning. Marked as a
 * reference line so the user sees how close the trajectory gets to the
 * threshold the backend classifies against.
 */
export const YOSHIKAWA_THRESHOLD = 0.3

/** YOSHIKAWA_THRESHOLD converted to the -log10 y axis: -log10(0.3) ≈ 0.523. */
export const LOG_YOSHIKAWA_THRESHOLD = toLogScale(YOSHIKAWA_THRESHOLD)

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

/** X coordinate of a series point: trajectory time in seconds when the wire
 *  carries it, else the waypoint index (hotfix temporal-axis fallback for
 *  payloads from older backends that predate the timestamp field). */
export function xCoordinateOf(point: ManipulabilityPointWire): number {
  return point.timestamp ?? point.waypoint
}

/** X axis for a per-waypoint series. With timestamps it is an honest temporal
 *  scale (`Time (s)`, minInterval 0.5 so dense trapezoidal samples don't
 *  over-tick); without them it falls back to the waypoint index axis of older
 *  payloads — a pure compatibility projection, never data synthesis. */
export function seriesXAxis(points: ManipulabilityPointWire[]): AxisConfig {
  const hasTimestamps = points.some((point) => point.timestamp !== undefined)
  if (!hasTimestamps) {
    return { type: 'value', name: 'Waypoint', min: 0, max: Math.max(0, points.length - 1) }
  }
  return {
    type: 'value',
    name: 'Time (s)',
    min: 0,
    max: Math.max(...points.map(xCoordinateOf)),
    minInterval: 0.5,
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
    data: points.map(
      (point: ManipulabilityPointWire) => [xCoordinateOf(point), point.yoshikawa] as [
        number,
        number,
      ],
    ),
    color: 'chart-1',
    smooth: false,
    areaStyle: true,
    dataColors: points.map((point) =>
      manipColorOf(severityByWaypoint.get(point.waypoint)),
    ),
  }

  return {
    title: 'Manipulability',
    series: [series],
    xAxis: [seriesXAxis(points)],
    // scale:true is deliberate — an axis that starts at the minimum shows the
    // real dynamic range of the linear series instead of squashing it against 0.
    yAxis: [{ type: 'value', name: 'Yoshikawa', scale: true }],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ],
    tooltip: { trigger: 'axis' },
    markLine: [
      {
        yAxis: YOSHIKAWA_THRESHOLD,
        label: `Threshold ${YOSHIKAWA_THRESHOLD}`,
        color: 'severity.warning',
      },
    ],
  }
}
