// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildTrajectoryRuns,
  grid3DFrame,
  regionAtWaypoint,
  severityAtWaypoint,
  severityColor,
  TRAJECTORY_COLOR_CRITICAL,
  TRAJECTORY_COLOR_NEUTRAL,
  TRAJECTORY_COLOR_WARNING,
  type Vec3,
} from './trajectory3d'
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
// seg1, warning (4,5) covers seg4; the rest stay clean.
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

describe('buildTrajectoryRuns — contiguous runs colored by problem region', () => {
  it('splits the polyline into severity runs: clean → critical → clean → warning', () => {
    const runs = buildTrajectoryRuns(waypoints, [criticalRegion, warningRegion])

    expect(runs).toHaveLength(4)
    expect(runs[0]).toMatchObject({
      severity: 'clean',
      color: TRAJECTORY_COLOR_NEUTRAL,
      regionId: null,
      waypointStart: 0,
      waypointEnd: 1,
    })
    expect(runs[1]).toMatchObject({
      severity: 'critical',
      color: TRAJECTORY_COLOR_CRITICAL,
      regionId: 1,
      waypointStart: 1,
      waypointEnd: 2,
    })
    expect(runs[2]).toMatchObject({ severity: 'clean', regionId: null, waypointStart: 2, waypointEnd: 4 })
    expect(runs[3]).toMatchObject({
      severity: 'warning',
      color: TRAJECTORY_COLOR_WARNING,
      regionId: 2,
      waypointStart: 4,
      waypointEnd: 5,
    })

    // Each run carries its own point list with contiguous waypoint indices.
    expect(runs[0].points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ])
    expect(runs[3].points).toEqual([
      { x: 4, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ])
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
    const runs = buildTrajectoryRuns(waypoints, [infoRegion, criticalRegion])

    // info[0..1] → critical[1..2] (most severe wins) → info[2..5]
    expect(runs.map((run) => [run.regionId, run.waypointStart, run.waypointEnd])).toEqual([
      [3, 0, 1],
      [1, 1, 2],
      [3, 2, 5],
    ])
    expect(runs[1]).toMatchObject({ severity: 'critical', regionId: 1 })
  })

  it('does not produce a run for a single-waypoint region (only the dot was colored on canvas)', () => {
    const pointRegion: ProblemRegionWire = {
      id: 5,
      kind: 'joint_limit',
      severity: 'critical',
      waypoint_start: 4,
      waypoint_end: 4,
      waypoint_count: 1,
    }
    const runs = buildTrajectoryRuns(waypoints, [pointRegion])

    expect(runs.every((run) => run.severity === 'clean')).toBe(true)
    expect(runs).toHaveLength(1)
  })

  it('returns no runs for a degenerate trajectory (fewer than 2 waypoints)', () => {
    expect(buildTrajectoryRuns([waypoints[0]], [])).toHaveLength(0)
    expect(buildTrajectoryRuns([], [])).toHaveLength(0)
  })
})

describe('severity lookup helpers', () => {
  it('maps the most severe region covering a waypoint', () => {
    const infoRegion: ProblemRegionWire = {
      id: 3,
      kind: 'tracking',
      severity: 'info',
      waypoint_start: 0,
      waypoint_end: 5,
      waypoint_count: 6,
    }
    expect(severityAtWaypoint([infoRegion, criticalRegion], 1)).toBe('critical')
    expect(regionAtWaypoint([infoRegion, criticalRegion], 1)?.id).toBe(1)
    expect(regionAtWaypoint([criticalRegion, warningRegion], 3)).toBeNull()
    expect(regionAtWaypoint([warningRegion], 4)?.id).toBe(2)
  })

  it('severityColor returns the palette color per severity', () => {
    expect(severityColor('clean')).toBe(TRAJECTORY_COLOR_NEUTRAL)
    expect(severityColor('critical')).toBe(TRAJECTORY_COLOR_CRITICAL)
    expect(severityColor('warning')).toBe(TRAJECTORY_COLOR_WARNING)
  })
})

describe('grid3DFrame — auto-fit box for the 3D axes', () => {
  it('pads the data range on every axis', () => {
    const frame = grid3DFrame(waypoints, 0.2)

    expect(frame.min).toEqual({ x: -1, y: -0.2, z: -0.2 })
    expect(frame.max).toEqual({ x: 6, y: 0.2, z: 0.2 })
    expect(frame.center).toEqual({ x: 2.5, y: 0, z: 0 })
  })

  it('scales the grid3D box to the padded spans, preserving aspect', () => {
    const frame = grid3DFrame(waypoints, 0.2)

    // Largest padded span (x = 7) maps to 100; y/z spans (0.4) scale proportionally.
    expect(frame.box.width).toBeCloseTo(100, 5)
    expect(frame.box.height).toBeCloseTo(100 * (0.4 / 7), 5)
    expect(frame.box.depth).toBeCloseTo(100 * (0.4 / 7), 5)
  })

  it('survives degenerate single-point input with a unit padding guard', () => {
    const frame = grid3DFrame([{ x: 2, y: 3, z: 0 }], 0.15)

    expect(frame.min.x).toBeLessThan(2)
    expect(frame.max.x).toBeGreaterThan(2)
    expect(frame.box.width).toBeGreaterThan(0)
    expect(frame.box.height).toBeGreaterThan(0)
  })
})
