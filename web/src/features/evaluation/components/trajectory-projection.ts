import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'

/**
 * Trajectory projection model — pure, framework-free math for the lightweight
 * 2D-canvas 3D view of the evaluated trajectory (evaluation hotfix CDD).
 *
 * The viewport (R3F) is hidden on /evaluation by design, so this module owns a
 * small standalone renderer: an orthographic camera with a WEAK perspective
 * divide (depth cue) plus yaw/pitch orbit. Everything is a pure function of
 * (waypoints, regions, orbit, size) so the coloring + picking rules are
 * unit-testable without a DOM.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Pt2 {
  x: number
  y: number
}

/** Viewer orbit — yaw around Y, then pitch around X. Radians. */
export interface Orbit {
  yaw: number
  pitch: number
}

export const ORBIT_IDENTITY: Orbit = { yaw: 0, pitch: 0 }

export const TRAJECTORY_COLOR_NEUTRAL = '#94a3b8'
export const TRAJECTORY_COLOR_CRITICAL = '#ef4444'
export const TRAJECTORY_COLOR_WARNING = '#f59e0b'
export const TRAJECTORY_COLOR_INFO = '#60a5fa'

export type SegmentSeverity = 'critical' | 'warning' | 'info' | 'clean'

/** One polyline segment between consecutive waypoints, classified by the
 *  problem region that covers it (if any). `regionId` is null for clean spans
 *  so click-picking can toggle the analysis selection. */
export interface TrajectorySegment {
  waypointStart: number
  waypointEnd: number
  start: Vec3
  end: Vec3
  projectedStart: Pt2
  projectedEnd: Pt2
  color: string
  severity: SegmentSeverity
  regionId: number | null
}

/** Yaw (around Y) then pitch (around X) rotation. */
export function rotate(v: Vec3, orbit: Orbit): Vec3 {
  const cosY = Math.cos(orbit.yaw)
  const sinY = Math.sin(orbit.yaw)
  const x1 = v.x * cosY + v.z * sinY
  const z1 = -v.x * sinY + v.z * cosY
  const cosP = Math.cos(orbit.pitch)
  const sinP = Math.sin(orbit.pitch)
  const y2 = v.y * cosP - z1 * sinP
  const z2 = v.y * sinP + z1 * cosP
  return { x: x1, y: y2, z: z2 }
}

/**
 * Build a projector from world space (under the given orbit) into a canvas of
 * the given size. Points are centered, fit within the padded bounds preserving
 * aspect, and y is flipped to screen space (down). A weak perspective divide on
 * the depth axis gives the 3D cue while staying cheap and deterministic.
 */
export function createProjector(
  points: Vec3[],
  width: number,
  height: number,
  orbit: Orbit,
  padding = 24,
): (p: Vec3) => Pt2 {
  const rotated = points.map((p) => rotate(p, orbit))
  const xs = rotated.map((p) => p.x)
  const ys = rotated.map((p) => p.y)
  const zs = rotated.map((p) => p.z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const spanX = Math.max(maxX - minX, 1e-9)
  const spanY = Math.max(maxY - minY, 1e-9)
  const spanZ = Math.max(maxZ - minZ, 1e-9)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  const availW = Math.max(width - padding * 2, 1)
  const availH = Math.max(height - padding * 2, 1)
  const scale = Math.min(availW / spanX, availH / spanY)

  return (p: Vec3) => {
    const r = rotate(p, orbit)
    const dz = (r.z - cz) / spanZ
    const persp = 1 / (1 + dz * 0.6)
    return {
      x: width / 2 + (r.x - cx) * scale * persp,
      y: height / 2 - (r.y - cy) * scale * persp,
    }
  }
}

const SEVERITY_RANK: Record<SegmentSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
  clean: 0,
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

/** Severity of the region covering a single waypoint, or 'clean'. */
export function severityAtWaypoint(
  regions: ProblemRegionWire[],
  waypoint: number,
): SegmentSeverity {
  let best: SegmentSeverity = 'clean'
  for (const region of regions) {
    if (waypoint < region.waypoint_start || waypoint > region.waypoint_end) continue
    const severity = severityOf(region)
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[best]) best = severity
  }
  return best
}

/** Region whose waypoint span FULLY contains the segment (i → i+1 inside
 *  [waypoint_start, waypoint_end]) — the red part of the trajectory is exactly
 *  the problematic span. Precedence: most severe, then first. */
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

/** Split the waypoint polyline into segments colored by the covering problem
 *  region (severity) or neutral when clean. Pure — safe to unit test. */
export function buildTrajectorySegments(
  waypoints: Vec3[],
  regions: ProblemRegionWire[],
  width: number,
  height: number,
  orbit: Orbit = ORBIT_IDENTITY,
): TrajectorySegment[] {
  const segments: TrajectorySegment[] = []
  if (waypoints.length < 2) return segments
  const projector = createProjector(waypoints, width, height, orbit)
  for (let i = 0; i < waypoints.length - 1; i++) {
    const region = regionCoveringSegment(regions, i)
    const severity = region ? severityOf(region) : 'clean'
    segments.push({
      waypointStart: i,
      waypointEnd: i + 1,
      start: waypoints[i],
      end: waypoints[i + 1],
      projectedStart: projector(waypoints[i]),
      projectedEnd: projector(waypoints[i + 1]),
      color: severityColor(severity),
      severity,
      regionId: region?.id ?? null,
    })
  }
  return segments
}

function distToSegment(px: number, py: number, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y)
  let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

/** Nearest segment whose 2D projection is within `tolerance` px of the pointer,
 *  or null. Drives click-to-select in the trajectory view. */
export function hitTestSegment(
  segments: TrajectorySegment[],
  x: number,
  y: number,
  tolerance = 10,
): TrajectorySegment | null {
  let best: TrajectorySegment | null = null
  let bestDist = tolerance
  for (const segment of segments) {
    const d = distToSegment(x, y, segment.projectedStart, segment.projectedEnd)
    if (d <= bestDist) {
      bestDist = d
      best = segment
    }
  }
  return best
}
