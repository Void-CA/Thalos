// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildTrajectoryRuns,
  grid3DFrame,
  regionAtWaypoint,
  severityAtWaypoint,
  severityColor,
  severityLabel,
  TRAJECTORY_COLOR_CRITICAL,
  TRAJECTORY_COLOR_END,
  TRAJECTORY_COLOR_START,
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

const criticalRegion: ProblemRegionWire = {
  id: 1,
  kind: 'singularity',
  severity: 'critical',
  waypoint_start: 1,
  waypoint_end: 2,
  waypoint_count: 2,
}

describe('buildTrajectoryRuns — contiguous severity runs over the polyline', () => {
  it('splits into one contiguous run per (severity, region) with global waypoint spans', () => {
    const runs = buildTrajectoryRuns(waypoints, [criticalRegion])
    expect(runs).toHaveLength(3)
    // Clean run before the critical region.
    expect(runs[0]).toMatchObject({ severity: 'clean', waypointStart: 0, waypointEnd: 1 })
    expect(runs[0].points).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])
    // The critical region's run — colored by severity.
    expect(runs[1]).toMatchObject({
      severity: 'critical',
      regionId: 1,
      waypointStart: 1,
      waypointEnd: 2,
      color: TRAJECTORY_COLOR_CRITICAL,
    })
    expect(runs[1].points).toEqual([{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])
    // Clean run after.
    expect(runs[2]).toMatchObject({ severity: 'clean' })
  })

  it('returns no runs for degenerate (< 2 waypoints) trajectories', () => {
    expect(buildTrajectoryRuns([], [])).toEqual([])
    expect(buildTrajectoryRuns([{ x: 0, y: 0, z: 0 }], [])).toEqual([])
  })
})

describe('regionAtWaypoint / severityAtWaypoint — most severe covering region', () => {
  it('resolves the covering region and its severity at a waypoint', () => {
    expect(regionAtWaypoint([criticalRegion], 1)?.id).toBe(1)
    expect(severityAtWaypoint([criticalRegion], 1)).toBe('critical')
    // Outside the span → clean.
    expect(regionAtWaypoint([criticalRegion], 0)).toBeNull()
    expect(severityAtWaypoint([criticalRegion], 4)).toBe('clean')
  })
})

describe('grid3DFrame — aspect-preserving auto-fit bounding frame', () => {
  it('pads the trajectory and keeps a flat (zero-span) axis from collapsing', () => {
    const frame = grid3DFrame(waypoints)
    // X span 0..5; flat y/z keep a unit-sized pad.
    expect(frame.span.x).toBeGreaterThan(5)
    expect(frame.span.y).toBeGreaterThan(0)
    expect(frame.span.z).toBeGreaterThan(0)
    // Box proportions are proportional to the spans (largest → 100).
    expect(frame.box.width).toBe(100)
    expect(frame.box.height).toBeGreaterThan(0)
    expect(frame.box.depth).toBeGreaterThan(0)
  })

  it('returns a safe default frame for an empty trajectory', () => {
    const frame = grid3DFrame([])
    expect(frame.box).toEqual({ width: 100, height: 100, depth: 100 })
    expect(frame.center).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('severity helpers — labels and colors', () => {
  it('labels each severity and maps to the theme colors', () => {
    expect(severityLabel('critical')).toBe('Critical')
    expect(severityLabel('warning')).toBe('Warning')
    expect(severityLabel('info')).toBe('Info')
    expect(severityLabel('clean')).toBe('Clean')
    expect(severityColor('critical')).toBe(TRAJECTORY_COLOR_CRITICAL)
  })

  it('colors the trajectory endpoints (start green / end red)', () => {
    expect(TRAJECTORY_COLOR_START).toBe('#22c55e')
    expect(TRAJECTORY_COLOR_END).toBe('#ef4444')
  })
})