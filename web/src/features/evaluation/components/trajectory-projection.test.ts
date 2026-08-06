// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildTrajectorySegments,
  createProjector,
  hitTestSegment,
  rotate,
  TRAJECTORY_COLOR_NEUTRAL,
  TRAJECTORY_COLOR_CRITICAL,
  TRAJECTORY_COLOR_WARNING,
  type Vec3,
} from './trajectory-projection'
import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'

const waypoints: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 3, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 5, y: 0, z: 0 },
]

// Segment i connects waypoint i → i+1. A segment is colored when it is FULLY
// inside the region's [waypoint_start, waypoint_end]: critical (1,2) covers
// seg1, warning (4,5) covers seg4; the rest stay neutral.
const criticalRegion: ProblemRegionWire = {
  id: 1,
  kind: 'singularity',
  severity: 'critical',
  waypoint_start: 1,
  waypoint_end: 2,
  waypoint_count: 2,
}

const warningRegion: ProblemRegionWire = {
  id: 2,
  kind: 'low_manipulability',
  severity: 'warning',
  waypoint_start: 4,
  waypoint_end: 5,
  waypoint_count: 2,
}

describe('buildTrajectorySegments — colors segments by problem region', () => {
  it('colors the problematic waypoint span red/amber and the rest neutral', () => {
    const segments = buildTrajectorySegments(waypoints, [criticalRegion, warningRegion], 640, 260)
    expect(segments).toHaveLength(5)
    expect(segments[0]).toMatchObject({
      severity: 'clean',
      color: TRAJECTORY_COLOR_NEUTRAL,
      regionId: null,
    })
    expect(segments[1]).toMatchObject({
      severity: 'critical',
      color: TRAJECTORY_COLOR_CRITICAL,
      regionId: 1,
    })
    expect(segments[2]).toMatchObject({ severity: 'clean', color: TRAJECTORY_COLOR_NEUTRAL })
    expect(segments[3]).toMatchObject({ severity: 'clean', color: TRAJECTORY_COLOR_NEUTRAL })
    expect(segments[4]).toMatchObject({
      severity: 'warning',
      color: TRAJECTORY_COLOR_WARNING,
      regionId: 2,
    })
  })

  it('gives precedence to the most severe overlapping region', () => {
    const infoRegion: ProblemRegionWire = {
      id: 3,
      kind: 'tracking',
      severity: 'info',
      waypoint_start: 0,
      waypoint_end: 5,
      waypoint_count: 6,
    }
    const segments = buildTrajectorySegments(waypoints, [infoRegion, criticalRegion], 640, 260)
    expect(segments[1]).toMatchObject({ severity: 'critical', regionId: 1 })
    expect(segments[2]).toMatchObject({ severity: 'info', regionId: 3 })
    expect(segments[3]).toMatchObject({ severity: 'info', regionId: 3 })
  })

  it('colors a single-waypoint region via the waypoint dot, not a segment', () => {
    const pointRegion: ProblemRegionWire = {
      id: 5,
      kind: 'joint_limit',
      severity: 'critical',
      waypoint_start: 4,
      waypoint_end: 4,
      waypoint_count: 1,
    }
    const segments = buildTrajectorySegments(waypoints, [pointRegion], 640, 260)
    expect(segments.every((s) => s.severity === 'clean')).toBe(true)
    expect(segments[3].severity).toBe('clean')
  })

  it('returns no segments for a degenerate trajectory (fewer than 2 waypoints)', () => {
    expect(buildTrajectorySegments([waypoints[0]], [], 640, 260)).toHaveLength(0)
    expect(buildTrajectorySegments([], [], 640, 260)).toHaveLength(0)
  })
})

describe('createProjector — weak-perspective projection into canvas space', () => {
  it('maps world points into the canvas bounds with screen-space y (down)', () => {
    const projector = createProjector(waypoints, 640, 260, { yaw: 0, pitch: 0 })
    const a = projector({ x: 0, y: 0, z: 0 })
    const b = projector({ x: 5, y: 0, z: 0 })
    expect(a.x).toBeGreaterThanOrEqual(0)
    expect(b.x).toBeLessThanOrEqual(640)
    expect(a.x).toBeLessThan(b.x)
    expect(a.y).toBeCloseTo(130, 0)
    expect(b.y).toBeCloseTo(130, 0)
  })

  it('rotating around Y moves previously-hidden depth into view', () => {
    const flat = rotate({ x: 1, y: 0, z: 0 }, { yaw: Math.PI / 2, pitch: 0 })
    expect(flat.x).toBeCloseTo(0, 5)
    expect(flat.z).toBeCloseTo(-1, 5)
  })
})

describe('hitTestSegment — picking a segment under the pointer', () => {
  it('returns the nearest segment within tolerance and null outside it', () => {
    const segments = buildTrajectorySegments(waypoints, [], 640, 260)
    const mid = segments[2]
    const hit = hitTestSegment(segments, mid.projectedStart.x + 0.5, mid.projectedStart.y, 10)
    expect(hit?.waypointStart).toBe(2)
    expect(hitTestSegment(segments, 10, 10, 10)).toBeNull()
  })
})
