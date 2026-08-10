import { describe, expect, it } from 'vitest'

import {
  manipulabilitySeriesOf,
  minClearanceDistance,
  minClearanceWaypoint,
  regionShareOfPlan,
  severityCounts,
  waypointAnalysisFromReport,
} from './analysis-report'
import type { AnalysisReportWire } from './analysis-report'

/** Minimal canonical report WITHOUT the new `manipulability_series` field —
 *  the "old client" payload shape (spec I3: additive backward compatibility). */
function baseReport(): AnalysisReportWire {
  return {
    artifact: { kind: 'MotionPlan', id: 'mp-1' },
    observations: [],
    actions: [],
    metrics: { waypoint_count: 3 },
    summary: {
      quality_index: 0.8,
      score: 80,
      grade: 'Good',
      observation_count: 0,
      severity_distribution: {},
    },
  }
}

describe('manipulability_series (S1 additive delta, spec motion-plan-endpoint)', () => {
  it('projects the series verbatim with waypoint + yoshikawa', () => {
    const report: AnalysisReportWire = {
      ...baseReport(),
      manipulability_series: [
        { waypoint: 0, yoshikawa: 0.42, det_jtj: 0.18 },
        { waypoint: 1, yoshikawa: 0.31 },
        { waypoint: 2, yoshikawa: 0.18 },
      ],
    }

    expect(report.manipulability_series).toHaveLength(3)
    expect(report.manipulability_series?.[0]).toEqual({ waypoint: 0, yoshikawa: 0.42, det_jtj: 0.18 })
    expect(report.manipulability_series?.[0]?.det_jtj).toBeCloseTo(0.18)
    expect(report.manipulability_series?.[2]?.yoshikawa).toBeCloseTo(0.18)
    // Additive field: older payloads omit it — consumers must tolerate absence.
    expect(report.manipulability_series?.[1]?.det_jtj).toBeUndefined()
  })

  it('old payloads without the field degrade to an empty series (I3)', () => {
    const oldReport = baseReport() // no manipulability_series

    // I3: absent field must not break consumers — default to [].
    expect(manipulabilitySeriesOf(oldReport)).toEqual([])
    // Pre-existing derived helpers keep working unchanged.
    expect(severityCounts(oldReport)).toEqual({ error: 0, warning: 0, info: 0 })
    expect(waypointAnalysisFromReport(oldReport)).toEqual([])
  })
})

describe('analysis metrics accessors (R1/R4 — min clearance + waypoint)', () => {
  it('reads min_collision_distance / min_collision_waypoint from the wire metrics', () => {
    const metrics = {
      min_collision_distance: 0.035,
      min_collision_waypoint: 4,
      has_collisions: 0,
    }
    expect(minClearanceDistance(metrics)).toBe(0.035)
    expect(minClearanceWaypoint(metrics)).toBe(4)
  })

  it('returns null when the optional clearance keys are absent', () => {
    expect(minClearanceDistance({})).toBeNull()
    expect(minClearanceWaypoint({})).toBeNull()
  })

  it('rounds the waypoint index (wire metric is a usize projected as f64)', () => {
    expect(minClearanceWaypoint({ min_collision_waypoint: 3.0 })).toBe(3)
  })
})

describe('regionShareOfPlan (R5 — region as % of the plan)', () => {
  const region = {
    id: 7,
    kind: 'singularity',
    severity: 'critical',
    waypoint_start: 10,
    waypoint_end: 12,
    waypoint_count: 3,
  }
  const series = [
    { waypoint: 10, yoshikawa: 0.1, timestamp: 5 },
    { waypoint: 11, yoshikawa: 0.2, timestamp: 6 },
    { waypoint: 12, yoshikawa: 0.3, timestamp: 7 },
    { waypoint: 30, yoshikawa: 0.9, timestamp: 20 },
  ]

  it('derives the % of plan from waypoint_count and the span duration from timestamps', () => {
    const share = regionShareOfPlan(region, series, { waypoint_count: 30 })
    expect(share.percentOfPlan).toBe(10) // 3 / 30
    expect(share.durationSecs).toBe(2) // 7 - 5, out-of-range wp30 excluded
  })

  it('returns null percent when the plan metrics carry no waypoint_count', () => {
    const share = regionShareOfPlan(region, series, {})
    expect(share.percentOfPlan).toBeNull()
  })

  it('returns null duration when fewer than two series points carry timestamps', () => {
    const share = regionShareOfPlan(region, [{ waypoint: 10, yoshikawa: 0.1 }], { waypoint_count: 30 })
    expect(share.percentOfPlan).toBe(10)
    expect(share.durationSecs).toBeNull()
  })
})
