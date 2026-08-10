/**
 * Trajectory 3D model — pure, framework-free math for the ECharts GL trajectory
 * view (evaluation hotfix CDD). Everything here is a pure function of
 * (waypoints, problem regions) so the coloring + run-grouping rules are
 * unit-testable without a DOM. This module never imports ECharts; the GL
 * option mapping lives in `gl-adapter.ts` (the single echarts-gl frontier).
 *
 * Segment semantics match the old canvas projection: a segment i → i+1 is
 * colored by the problem region that FULLY covers it (precedence: most severe,
 * then first). Consecutive segments sharing a (severity, region) become one
 * contiguous `TrajectoryRun`, so the 3D polyline never jumps across unrelated
 * waypoints. Single-waypoint regions (start === end) cover no segment and are
 * intentionally absent from the line (they were dots on the old canvas).
 */

import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type SegmentSeverity = 'critical' | 'warning' | 'info' | 'clean'

export const TRAJECTORY_COLOR_NEUTRAL = '#94a3b8'
export const TRAJECTORY_COLOR_CRITICAL = '#ef4444'
export const TRAJECTORY_COLOR_WARNING = '#f59e0b'
export const TRAJECTORY_COLOR_INFO = '#60a5fa'
export const TRAJECTORY_COLOR_MARKER = '#22c55e'
/** Start marker — green circle, the "departure" of the trajectory. */
export const TRAJECTORY_COLOR_START = '#22c55e'
/** End marker — red circle, the "arrival" of the trajectory. */
export const TRAJECTORY_COLOR_END = '#ef4444'

const SEVERITY_RANK: Record<SegmentSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
  clean: 0,
}

/** Human label for a run — reused for the tooltip and the series name. */
export function severityLabel(severity: SegmentSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Critical'
    case 'warning':
      return 'Warning'
    case 'info':
      return 'Info'
    default:
      return 'Clean'
  }
}

export function severityOf(region: ProblemRegionWire): SegmentSeverity {
  if (region.severity === 'critical' || region.severity === 'error') return 'critical'
  if (region.severity === 'warning') return 'warning'
  return 'info'
}

export function severityColor(severity: SegmentSeverity): string {
  switch (severity) {
    case 'critical':
      return TRAJECTORY_COLOR_CRITICAL
    case 'warning':
      return TRAJECTORY_COLOR_WARNING
    case 'info':
      return TRAJECTORY_COLOR_INFO
    default:
      return TRAJECTORY_COLOR_NEUTRAL
  }
}

/** Most severe region covering a single waypoint, or null when clean. */
export function regionAtWaypoint(
  regions: ProblemRegionWire[],
  waypoint: number,
): ProblemRegionWire | null {
  let best: ProblemRegionWire | null = null
  for (const region of regions) {
    if (waypoint < region.waypoint_start || waypoint > region.waypoint_end) continue
    if (!best || SEVERITY_RANK[severityOf(region)] > SEVERITY_RANK[severityOf(best)]) {
      best = region
    }
  }
  return best
}

/** Severity of the most severe region covering a waypoint, or 'clean'. */
export function severityAtWaypoint(
  regions: ProblemRegionWire[],
  waypoint: number,
): SegmentSeverity {
  const region = regionAtWaypoint(regions, waypoint)
  return region === null ? 'clean' : severityOf(region)
}

/** Region whose waypoint span FULLY contains the segment (i → i+1 inside
 *  [waypoint_start, waypoint_end]). Precedence: most severe, then first. */
function regionCoveringSegment(
  regions: ProblemRegionWire[],
  segmentIndex: number,
): ProblemRegionWire | null {
  let best: ProblemRegionWire | null = null
  for (const region of regions) {
    const inside =
      region.waypoint_start <= segmentIndex && segmentIndex + 1 <= region.waypoint_end
    if (!inside) continue
    if (!best || SEVERITY_RANK[severityOf(region)] > SEVERITY_RANK[severityOf(best)]) {
      best = region
    }
  }
  return best
}

/** One contiguous polyline run: consecutive segments with the same covering
 *  region (or clean). `waypointStart`/`waypointEnd` are GLOBAL waypoint
 *  indices, so click-picking and tooltips can map back to the full trajectory. */
export interface TrajectoryRun {
  severity: SegmentSeverity
  color: string
  regionId: number | null
  waypointStart: number
  waypointEnd: number
  points: Vec3[]
}

/** Split the waypoint polyline into contiguous severity runs. Pure — safe to
 *  unit test. Returns [] for degenerate trajectories (< 2 waypoints). */
export function buildTrajectoryRuns(
  waypoints: Vec3[],
  regions: ProblemRegionWire[],
): TrajectoryRun[] {
  const runs: TrajectoryRun[] = []
  if (waypoints.length < 2) return runs

  let runStart = 0
  let runSeverity: SegmentSeverity = 'clean'
  let runRegionId: number | null = null
  for (let i = 0; i < waypoints.length - 1; i++) {
    const region = regionCoveringSegment(regions, i)
    const severity = region === null ? 'clean' : severityOf(region)
    const regionId = region?.id ?? null
    if (i === 0) {
      runSeverity = severity
      runRegionId = regionId
      continue
    }
    if (severity === runSeverity && regionId === runRegionId) continue
    runs.push({
      severity: runSeverity,
      color: severityColor(runSeverity),
      regionId: runRegionId,
      waypointStart: runStart,
      waypointEnd: i,
      points: waypoints.slice(runStart, i + 1),
    })
    runStart = i
    runSeverity = severity
    runRegionId = regionId
  }
  runs.push({
    severity: runSeverity,
    color: severityColor(runSeverity),
    regionId: runRegionId,
    waypointStart: runStart,
    waypointEnd: waypoints.length - 1,
    points: waypoints.slice(runStart),
  })
  return runs
}

/** Padded bounding frame of the trajectory + a grid3D box that preserves the
 *  data's aspect ratio (so a flat-z SCARA path isn't squashed into a cube). */
export interface Grid3DFrame {
  min: Vec3
  max: Vec3
  span: Vec3
  /** grid3D box proportions — largest padded span maps to 100 units. */
  box: { width: number; height: number; depth: number }
  center: Vec3
}

/** Auto-fit the grid3D box + axis ranges to the trajectory, with a proportional
 *  margin (default 15% of the span per axis; a flat axis is padded by 15% of a
 *  unit so the grid never collapses). */
export function grid3DFrame(waypoints: Vec3[], paddingRatio = 0.15): Grid3DFrame {
  const rawMin: Vec3 = { x: Infinity, y: Infinity, z: Infinity }
  const rawMax: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of waypoints) {
    rawMin.x = Math.min(rawMin.x, p.x)
    rawMin.y = Math.min(rawMin.y, p.y)
    rawMin.z = Math.min(rawMin.z, p.z)
    rawMax.x = Math.max(rawMax.x, p.x)
    rawMax.y = Math.max(rawMax.y, p.y)
    rawMax.z = Math.max(rawMax.z, p.z)
  }
  if (waypoints.length === 0) {
    const zero: Vec3 = { x: 0, y: 0, z: 0 }
    return { min: zero, max: zero, span: zero, box: { width: 100, height: 100, depth: 100 }, center: zero }
  }

  const pad = (axis: keyof Vec3): number => {
    const span = rawMax[axis] - rawMin[axis]
    const effectiveSpan = span === 0 ? 1 : span
    return effectiveSpan * paddingRatio
  }
  const min: Vec3 = {
    x: rawMin.x - pad('x'),
    y: rawMin.y - pad('y'),
    z: rawMin.z - pad('z'),
  }
  const max: Vec3 = {
    x: rawMax.x + pad('x'),
    y: rawMax.y + pad('y'),
    z: rawMax.z + pad('z'),
  }
  const span: Vec3 = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }
  const center: Vec3 = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }

  const largest = Math.max(span.x, span.y, span.z)
  const scale = largest === 0 ? 1 : 100 / largest
  return {
    min,
    max,
    span,
    box: { width: span.x * scale, height: span.y * scale, depth: span.z * scale },
    center,
  }
}
