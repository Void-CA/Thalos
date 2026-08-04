import { describe, expect, it } from 'vitest'

import {
  manipulabilitySeriesOf,
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
        { waypoint: 0, yoshikawa: 0.42 },
        { waypoint: 1, yoshikawa: 0.31 },
        { waypoint: 2, yoshikawa: 0.18 },
      ],
    }

    expect(report.manipulability_series).toHaveLength(3)
    expect(report.manipulability_series?.[0]).toEqual({ waypoint: 0, yoshikawa: 0.42 })
    expect(report.manipulability_series?.[2]?.yoshikawa).toBeCloseTo(0.18)
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
