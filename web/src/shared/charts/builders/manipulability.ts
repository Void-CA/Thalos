/**
 * Manipulability chart builder — pure function, spec manipulability-chart.
 *
 * Input: canonical AnalysisReportWire (never a hand-built shape — I1).
 * Output: ChartModel. NO ECharts, NO React, NO DOM (O2).
 *
 * Presentation transformations only (I2): projects the NORMALIZED yoshikawa
 * series (∏σ′ᵢ, dimensionless) as the primary line on its NATURAL linear
 * scale, marks the constant dimensionless thresholds T_LOW / T_HIGH as
 * reference lines (never an absolute raw 0.3), colors each waypoint by the
 * severity of the observations anchored there (unchanged presentation), and
 * adds the dataZoom slider+inside. Hover shows waypoint index + normalized +
 * grade + raw via the pure [`formatManipulabilityTooltip`].
 *
 * Legacy payloads (no `normalized_yoshikawa` / `manipulability_grade`) fall
 * back to a local normalized estimate from `raw / L_ref³` — the frontend
 * never fabricates a backend grade (spec "Legacy Payload Fallback").
 */

import type {
  AnalysisReportWire,
  ManipulabilityPointWire,
} from '@/shared/contracts/analysis-report'
import { manipulabilitySeriesOf, waypointOf } from '@/shared/contracts/analysis-report'
import {
  T_HIGH,
  T_LOW,
  classifyGrade,
  computeFallbackNormalized,
  type ManipulabilityGradeWire,
} from '@/shared/contracts/manipulability-normalization'
import type { AxisConfig, ChartModel, TooltipConfig } from '../types'

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

/** X coordinate of a series point: trajectory time in seconds when the wire
 *  carries it, else the waypoint index. */
export function xCoordinateOf(point: ManipulabilityPointWire): number {
  return point.timestamp ?? point.waypoint
}

/** X axis for a per-waypoint series. With timestamps it is an honest temporal
 *  scale (`Time (s)`, minInterval 0.5 so dense trapezoidal samples don't
 *  over-tick); without them it falls back to the waypoint index axis. */
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

/**
 * Whether the payload carries the backend normalized measure (new payload
 *  signal). The presence signal is `manipulability_grade` (design "Grade as
 *  Option for presence signal"), NOT `normalized_yoshikawa` — a raw path
 *  backend omits the field from the wire, but a `0.0` normalized value is a
 *  VALID measure (singularity), so it can never be the absence signal.
 */
export function hasBackendNormalization(points: ManipulabilityPointWire[]): boolean {
  return points.some((p) => p.manipulability_grade !== undefined)
}

/**
 * The normalized measure for a point: the backend value when the payload is
 * normalized (grade present — consumed verbatim, I2), else the local fallback
 * `raw / L_ref³` (legacy payloads only). A present `normalized_yoshikawa`
 * WITHOUT a grade is treated as legacy (raw path → flat zeros): the fallback
 * runs instead of plotting a fabricated 0.0.
 */
function normalizedOf(point: ManipulabilityPointWire, lRef: number): number {
  if (
    point.manipulability_grade !== undefined &&
    point.normalized_yoshikawa !== undefined
  ) {
    return point.normalized_yoshikawa
  }
  return computeFallbackNormalized(point.yoshikawa, lRef)
}

/** The grade for a point: backend grade when present, else the local
 *  classification of the fallback normalized value (legacy payloads). */
function gradeOf(point: ManipulabilityPointWire, lRef: number): ManipulabilityGradeWire {
  if (point.manipulability_grade !== undefined) return point.manipulability_grade
  return classifyGrade(normalizedOf(point, lRef))
}

/**
 * Pure tooltip body for a hovered point (spec "Tooltip on Hover": waypoint
 * index, normalized_yoshikawa, manipulability_grade and raw_yoshikawa).
 * `axisValue` is the x coordinate of the hovered point (timestamp or waypoint
 * index); the point is looked up by that coordinate. `lRef` mirrors the
 * builder's fallback reference dimension so the tooltip agrees with the plot
 * on legacy payloads.
 */
export function formatManipulabilityTooltip(
  axisValue: number,
  points: ManipulabilityPointWire[],
  lRef: number = 1.0,
): string {
  const point = points.find((p) => xCoordinateOf(p) === axisValue)
  if (!point) {
    return `<div class="chart-tooltip"><b>Manipulability</b><br/>No data for x=${axisValue}</div>`
  }
  const normalized = normalizedOf(point, lRef)
  const grade = gradeOf(point, lRef)
  return [
    '<div class="chart-tooltip">',
    `<b>Manipulability</b><br/>`,
    `Waypoint ${point.waypoint}<br/>`,
    `Normalized: ${normalized.toFixed(4)}<br/>`,
    `Grade: ${grade}<br/>`,
    `Raw: ${point.yoshikawa.toFixed(4)}`,
    '</div>',
  ].join('')
}

/** Line chart of per-waypoint NORMALIZED manipulability with dataZoom. */
export function manipulabilityBuilder(report: AnalysisReportWire, lRef?: number): ChartModel {
  const points = manipulabilitySeriesOf(report)
  if (points.length === 0) {
    return { series: [], xAxis: [], empty: { message: 'No manipulability data available' } }
  }

  const severityByWaypoint = worstSeverityByWaypoint(report)
  // Legacy payloads (no backend normalized values) use the local L_ref for
  // the fallback. `lRef ?? 1.0` degrades ONLY when no scene is loaded (the
  // caller must pass the scene's referenceDimension when available) — at
  // L_ref = 1.0 the fallback is a raw-preserving no-op, never NaN/Inf.
  const fallbackLRef = lRef ?? 1.0

  const series = {
    name: 'Normalized manipulability',
    type: 'line' as const,
    data: points.map(
      (point: ManipulabilityPointWire) =>
        [xCoordinateOf(point), normalizedOf(point, fallbackLRef)] as [number, number],
    ),
    color: 'chart-1',
    smooth: false,
    areaStyle: true,
    dataColors: points.map((point) =>
      manipColorOf(severityByWaypoint.get(point.waypoint)),
    ),
  }

  const tooltip: TooltipConfig = {
    trigger: 'axis',
    formatter: (params) => {
      const first = Array.isArray(params) ? params[0] : undefined
      const axisValue =
        typeof first === 'object' && first !== null && 'axisValue' in first
          ? Number((first as { axisValue: unknown }).axisValue)
          : NaN
      return formatManipulabilityTooltip(
        Number.isFinite(axisValue) ? axisValue : 0,
        points,
        fallbackLRef,
      )
    },
  }

  return {
    title: 'Manipulability',
    series: [series],
    xAxis: [seriesXAxis(points)],
    // scale:true is deliberate — an axis that starts at the minimum shows the
    // real dynamic range of the linear series instead of squashing it against 0.
    yAxis: [{ type: 'value', name: 'Normalized', scale: true }],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ],
    tooltip,
    markLine: [
      {
        yAxis: T_LOW,
        label: `Low ${T_LOW}`,
        color: 'severity.warning',
      },
      {
        yAxis: T_HIGH,
        label: `High ${T_HIGH}`,
        color: 'severity.good',
      },
    ],
  }
}
