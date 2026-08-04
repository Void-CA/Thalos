import { describe, it, expect } from 'vitest'
import { traceBuilder } from './trace'
import type {
  MotionSampleWire,
  MotionTraceWire,
  SessionSummary,
} from '@/features/sessions/api/session-api'
import type { ChartModel } from '../types'

/**
 * C1 remediation — traceBuilder (spec trace-chart, 4 reqs / 7 scenarios).
 *
 * The builder projects the CANONICAL MotionTraceWire from GET /sessions/{id}/trace
 * into a multi-series line ChartModel — one line per joint, X axis = time.
 * Invariants under test:
 *  - Position series rendered: N joints → N line series, positions VERBATIM.
 *  - Empty trace: zero samples → explicit empty state, no series drawn.
 *  - Canonical source (I1 negative): the builder accepts ONLY MotionTraceWire —
 *    a /sessions list row is rejected by the type system.
 *  - Presentation only (I2 negative): the builder NEVER synthesizes samples
 *    across a gap and NEVER derives series from velocities, target_joints or
 *    errors (no client-side RMSE / tracking error computation).
 *  - Presentation transformations: X labels formatted mm:ss, joint colors
 *    cycle --chart-1..4.
 */

function sample(
  timestamp: number,
  joints: number[],
  overrides: Partial<MotionSampleWire> = {},
): MotionSampleWire {
  return {
    timestamp,
    joints,
    velocities: joints.map((j) => j * 2),
    target_joints: joints.map((j) => j + 0.5),
    progress: 0.5,
    errors: [],
    ...overrides,
  }
}

function trace(samples: MotionSampleWire[]): MotionTraceWire {
  return { samples }
}

describe('traceBuilder — multi-series joint position chart (spec trace-chart)', () => {
  it('renders one line series per joint, positions VERBATIM, X axis = time (mm:ss)', () => {
    const model = traceBuilder(
      trace([sample(0, [0.1, 0.2]), sample(5, [0.3, 0.4]), sample(10, [0.5, 0.6])]),
    )

    expect(model.empty).toBeUndefined()
    expect(model.series).toHaveLength(2)
    expect(model.series[0].name).toBe('Joint 1')
    expect(model.series[0].type).toBe('line')
    // Canonical position values — projected, never recomputed (I2).
    expect(model.series[0].data).toEqual([0.1, 0.3, 0.5])
    expect(model.series[1].data).toEqual([0.2, 0.4, 0.6])
    // The X axis is TIME (spec scenario "Position series rendered"), with the
    // mm:ss formatting the spec's "time formatting" scenario allows.
    expect(model.xAxis[0].categories).toEqual(['0:00', '0:05', '0:10'])
  })

  it('shows the explicit empty state when the trace has zero samples (scenario "Empty trace")', () => {
    const model = traceBuilder(trace([]))

    expect(model.empty?.message).toBe('No trace data')
    expect(model.series).toEqual([])
    expect(model.xAxis).toEqual([])
  })

  it('NEVER synthesizes samples across a gap — one point per canonical sample (negative)', () => {
    const model = traceBuilder(trace([sample(0, [0.1]), sample(5, [0.2]), sample(30, [0.9])]))

    // Exactly 3 points — no intermediate sample fabricated between 0:05 and 0:30.
    expect(model.series[0].data).toEqual([0.1, 0.2, 0.9])
    expect(model.series[0].data).toHaveLength(3)
    // The time jump stays visible on the axis labels — the gap is not hidden.
    expect(model.xAxis[0].categories).toEqual(['0:00', '0:05', '0:30'])
  })

  it('projects ONLY joint positions — never derives series from velocities, target_joints or errors (I2 negative)', () => {
    const model = traceBuilder(
      trace([
        sample(0, [0.1, 0.2], { velocities: [9.9, 8.8], target_joints: [1.0, 2.0], errors: ['overshoot'] }),
        sample(1, [0.15, 0.25], { velocities: [9.8, 8.7], target_joints: [1.05, 2.05], errors: [] }),
      ]),
    )

    // Exactly one series per joint, nothing derived from the other fields.
    expect(model.series.map((s) => s.name)).toEqual(['Joint 1', 'Joint 2'])
    expect(model.series[0].data).toEqual([0.1, 0.15])
    expect(model.series[1].data).toEqual([0.2, 0.25])
  })

  it('triangulates: colors cycle --chart-1..4 across joints and mm:ss carries minute rollover', () => {
    const model = traceBuilder(trace([sample(0, [0, 0, 0, 0, 0]), sample(65, [1, 1, 1, 1, 1])]))

    expect(model.series).toHaveLength(5)
    expect(model.series.map((s) => s.color)).toEqual([
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-1',
    ])
    // 65s → "1:05" (spec "time formatting" scenario, minute rollover).
    expect(model.xAxis[0].categories).toEqual(['0:00', '1:05'])
  })

  it('rejects non-canonical input at the type level (I1 negative — /sessions row is NOT /trace)', () => {
    // Type-only contract, enforced by the `pnpm exec tsc -b` gate: test files
    // are type-checked (tsconfig.app includes src), and the helper below only
    // compiles while its @ts-expect-error stays satisfied — i.e. while the
    // builder rejects a SessionSummary. Vitest strips types, so the helper is
    // never invoked at runtime; the runtime assertion anchors the module the
    // type check depends on (all behavioral cases live in the tests above).
    expect(typeof traceBuilder).toBe('function')
    // Reference (never invoke) the compile-time guard so the tsc gate validates
    // its @ts-expect-error: vitest strips types, so calling it would run the
    // builder with a non-canonical row — referencing keeps it type-checked.
    void rejectsSessionRowAtTypeLevel
  })
})

/** Compile-time only: feeding the builder a /sessions row is a type error
 *  (spec negative scenario "trace from non-canonical source"). Never invoked
 *  at runtime — the `tsc -b` gate validates the @ts-expect-error. */
function rejectsSessionRowAtTypeLevel(): void {
  const sessionRow: SessionSummary = {
    id: 1,
    plan_id: 'plan-a',
    source: 'live',
    status: 'Completed',
    started_at: '2026-08-01T10:00:00Z',
    paused_at: null,
    completed_at: null,
    duration: 12.5,
    joint_count: 4,
    robot_name: 'SCARA',
  }
  // @ts-expect-error — traceBuilder consumes ONLY GET /sessions/{id}/trace
  // (MotionTraceWire); a /sessions list row must be rejected by the type system.
  const rejected: ChartModel = traceBuilder(sessionRow)
  void rejected
}
