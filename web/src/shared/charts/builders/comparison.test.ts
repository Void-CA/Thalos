import { describe, it, expect } from 'vitest'
import { comparisonBuilder } from './comparison'
import type { SessionComparisonWire } from '@/features/sessions/api/session-api'

/**
 * S6.1 — comparisonBuilder (spec comparison-chart, invariant I5).
 *
 * The builder receives the CANONICAL SessionComparisonResponse and projects it
 * into a ChartModel. It MUST NEVER recalculate RMSE, max error or any
 * ComparisonMetrics field (I5) — the wire carries no raw plan/execution
 * samples, so the only possible source of every displayed number is
 * `response.metrics`. The tests pin that the projected values equal the
 * canonical fields EXACTLY (a recomputation would produce different numbers),
 * and that `aligned_pair_count = 0` yields the spec's "no comparable data"
 * empty state.
 */

const OBSERVATION = {
  id: 1,
  kind: 'TrackingDeviation',
  severity: 'Warning' as const,
  artifact: { kind: 'ExecutionSession', id: '1' },
  location: { Waypoint: 3 },
  attributes: {},
  causes: [],
  related: [],
}

function baseComparison(
  metrics: SessionComparisonWire['metrics'],
  aligned_pair_count = 120,
): SessionComparisonWire {
  return {
    metrics,
    observations: [OBSERVATION],
    aligned_pair_count,
  }
}

const METRICS_3JOINT = {
  global_rmse: 0.015,
  global_max_error: 0.042,
  global_avg_error: 0.009,
  per_joint: { rmse: [0.01, 0.02, 0.015], max_error: [0.03, 0.042, 0.028], avg_error: [0.006, 0.012, 0.009] },
  max_tracking_error: 0.031,
  avg_tracking_error: 0.007,
  max_velocity_deviation: [0.2, 0.15, 0.11],
  aligned_count: 120,
}

describe('comparisonBuilder — per-joint RMSE bar chart from canonical metrics (I5)', () => {
  it('projects metrics.per_joint.rmse VERBATIM into a bar series — no recalculation', () => {
    const response = baseComparison(METRICS_3JOINT)
    const model = comparisonBuilder(response)

    expect(model.empty).toBeUndefined()
    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('bar')
    expect(model.series[0].name).toBe('RMSE (rad)')
    // Exactly the canonical array values — if the builder recomputed RMSE from
    // raw samples (which the wire does not even carry), these would differ.
    expect(model.series[0].data).toEqual([0.01, 0.02, 0.015])
    expect(model.xAxis[0].categories).toEqual(['Joint 1', 'Joint 2', 'Joint 3'])
  })

  it('draws the global RMSE reference line ONLY from metrics.global_rmse (I5 negative)', () => {
    const response = baseComparison(METRICS_3JOINT)
    const model = comparisonBuilder(response)

    // markLine.yAxis === the canonical global_rmse exactly — the chart never
    // derives RMSE from per-joint values or any other client-side source.
    expect(model.markLine).toHaveLength(1)
    expect(model.markLine![0].yAxis).toBe(0.015)
    expect(model.markLine![0].label).toContain('0.0150')
  })

  it('renders "no comparable data" when aligned_pair_count is 0', () => {
    const emptyMetrics: SessionComparisonWire['metrics'] = {
      global_rmse: 0,
      global_max_error: 0,
      global_avg_error: 0,
      per_joint: { rmse: [], max_error: [], avg_error: [] },
      max_tracking_error: null,
      avg_tracking_error: null,
      max_velocity_deviation: [],
      aligned_count: 0,
    }
    const model = comparisonBuilder(baseComparison(emptyMetrics, 0))

    expect(model.empty?.message).toBe('No comparable data')
    expect(model.series).toEqual([])
    expect(model.markLine).toBeUndefined()
  })

  it('triangulates: a 4-joint comparison projects its OWN values and labels', () => {
    const fourJoint = {
      global_rmse: 0.0082,
      global_max_error: 0.021,
      global_avg_error: 0.0051,
      per_joint: {
        rmse: [0.009, 0.007, 0.011, 0.006],
        max_error: [0.02, 0.015, 0.021, 0.013],
        avg_error: [0.005, 0.004, 0.007, 0.003],
      },
      max_tracking_error: null,
      avg_tracking_error: null,
      max_velocity_deviation: [0.4, 0.31, 0.22, 0.28],
      aligned_count: 90,
    }
    const model = comparisonBuilder(baseComparison(fourJoint, 90))

    expect(model.series[0].data).toEqual([0.009, 0.007, 0.011, 0.006])
    expect(model.xAxis[0].categories).toEqual(['Joint 1', 'Joint 2', 'Joint 3', 'Joint 4'])
    expect(model.markLine![0].yAxis).toBe(0.0082)
  })
})
