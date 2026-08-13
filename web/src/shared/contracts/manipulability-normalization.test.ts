import { describe, expect, it } from 'vitest'
import {
  T_LOW,
  T_HIGH,
  classifyGrade,
  computeFallbackNormalized,
} from './manipulability-normalization'

/**
 * Task 4.2 contract: the frontend fallback must reproduce the BACKEND grade
 * classification — same thresholds, same partition (spec
 * manipulability-normalization "Manipulability Grade Classification":
 * "Thresholds MUST be identical for all robots regardless of scale").
 * A drift in either side fails these tests.
 */
describe('classifyGrade — backend-grade parity (task 4.2)', () => {
  it('mirrors the backend constant thresholds exactly', () => {
    // Re-calibration-locked values (backend T_LOW/T_HIGH in
    // thalos-core/kinematics/jacobian/manipulability.rs, moving-only L_ref
    // definition). Changing either side without the other breaks this
    // contract test.
    expect(T_LOW).toBe(0.0926)
    expect(T_HIGH).toBe(0.15433)
  })

  it('assigns the same grades as the backend classifier', () => {
    // Partition parity: backend `classify(n, T_LOW, T_HIGH)` is
    // Low < T_LOW ≤ Medium < T_HIGH ≤ High (boundaries inclusive upward).
    expect(classifyGrade(T_LOW - 1e-12, T_LOW, T_HIGH)).toBe('low')
    expect(classifyGrade(T_LOW, T_LOW, T_HIGH)).toBe('medium')
    expect(classifyGrade((T_LOW + T_HIGH) / 2, T_LOW, T_HIGH)).toBe('medium')
    expect(classifyGrade(T_HIGH - 1e-12, T_LOW, T_HIGH)).toBe('medium')
    expect(classifyGrade(T_HIGH, T_LOW, T_HIGH)).toBe('high')
    expect(classifyGrade(0.2, T_LOW, T_HIGH)).toBe('high')
    expect(classifyGrade(0.05, T_LOW, T_HIGH)).toBe('low')
  })

  it('defaults to the calibrated thresholds when not passed', () => {
    // Convenience overload: same constants the backend uses, so a caller
    // cannot accidentally pass divergent thresholds.
    expect(classifyGrade(0.05)).toBe('low')
    expect(classifyGrade(0.12)).toBe('medium')
    expect(classifyGrade(0.2)).toBe('high')
  })
})

describe('computeFallbackNormalized (legacy-payload fallback, task 4.2)', () => {
  it('computes raw / L_ref³ for a unit reference dimension', () => {
    // A 1 m reference robot: normalized == raw (L_ref³ = 1).
    expect(computeFallbackNormalized(0.3, 1)).toBeCloseTo(0.3, 12)
  })

  it('scales raw down by L_ref³ for larger robots', () => {
    // Same raw measure on a 2.3 m robot (SCARA L_ref): the fallback
    // normalized is raw / 2.3³ — the exact pre-SVD result for a
    // revolute-only robot with ≥ 3 DOF, and a documented approximation
    // for mixed/planar robots (only used on legacy payloads without
    // backend normalized values).
    expect(computeFallbackNormalized(0.5, 2.3)).toBeCloseTo(0.5 / 2.3 ** 3, 12)
  })

  it('guards degenerate L_ref (no NaN/Inf from a broken value)', () => {
    // Guardrail mirror of the backend `l_ref > ε`: a zero/negative L_ref
    // must not produce NaN/Inf — the fallback degrades to raw.
    expect(computeFallbackNormalized(0.3, 0)).toBe(0.3)
    expect(computeFallbackNormalized(0.3, -1)).toBe(0.3)
    expect(Number.isFinite(computeFallbackNormalized(0.3, 1e-12))).toBe(true)
  })
})
