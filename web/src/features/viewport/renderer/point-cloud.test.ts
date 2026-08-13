import { describe, expect, it } from 'vitest'
import { MANIP_HIGH, MANIP_MED, MANIP_LOW, CLOUD_GENERIC, CLOUD_WORKSPACE } from '@/shared/tokens'
import { pickColor, type PickablePoint } from './point-cloud'

/**
 * Task 5.3 (spec manipulability-normalization "Point-cloud consumes grade"):
 * pickColor uses the BACKEND grade when present and falls back to the SAME
 * normalized classification as the chart (computeFallbackNormalized +
 * classifyGrade with the scene L_ref) ONLY for legacy payloads (grade absent).
 */
describe('pickColor — manipulability grade from the backend (task 5.3)', () => {
  function point(overrides: Partial<PickablePoint>): PickablePoint {
    return { position: [0, 0, 0], ...overrides }
  }

  it('colors by the backend grade when present', () => {
    expect(pickColor(point({ grade: 'low', yoshikawa: 0.9 }), 'manipulability').getHex()).toBe(
      MANIP_LOW,
    )
    expect(pickColor(point({ grade: 'medium' }), 'manipulability').getHex()).toBe(MANIP_MED)
    expect(pickColor(point({ grade: 'high' }), 'manipulability').getHex()).toBe(MANIP_HIGH)
  })

  it('prefers grade over the raw measure when both are present', () => {
    // A high raw measure with a backend low grade must color LOW — the
    // backend classification is authoritative (I2: the UI never reclassifies).
    expect(
      pickColor(point({ grade: 'low', yoshikawa: 0.9 }), 'manipulability').getHex(),
    ).toBe(MANIP_LOW)
  })

  it('falls back to the normalized thresholds for legacy payloads (no grade)', () => {
    // Legacy point: no grade → the SAME normalized classification as the chart
    // (computeFallbackNormalized + classifyGrade at L_ref 1.0 → normalized ==
    // raw), never the old raw 0.3/0.5 partition. 0.4 raw sits ABOVE T_HIGH, so
    // it colors HIGH on a unit robot (the chart agrees); 0.05 sits below T_LOW.
    expect(pickColor(point({ yoshikawa: 0.6 }), 'manipulability').getHex()).toBe(MANIP_HIGH)
    expect(pickColor(point({ yoshikawa: 0.4 }), 'manipulability').getHex()).toBe(MANIP_HIGH)
    expect(pickColor(point({ yoshikawa: 0.05 }), 'manipulability').getHex()).toBe(MANIP_LOW)
  })

  it('scales the legacy fallback with the scene L_ref', () => {
    // A 0.4 raw measure on a 2 m robot normalizes to 0.4/2³ = 0.05 → LOW
    // (below T_LOW) — consistent with the chart; at L_ref 1.0 the same raw
    // value classifies HIGH.
    expect(pickColor(point({ yoshikawa: 0.4 }), 'manipulability', 2).getHex()).toBe(MANIP_LOW)
    expect(pickColor(point({ yoshikawa: 0.4 }), 'manipulability', 1).getHex()).toBe(MANIP_HIGH)
  })

  it('degrades to the generic cloud color when neither grade nor measure exists', () => {
    expect(pickColor(point({}), 'manipulability').getHex()).toBe(CLOUD_GENERIC)
  })

  it('ignores grade outside the manipulability color mode', () => {
    // In workspace mode the grade never influences the color (only the
    // workspace token applies).
    expect(pickColor(point({ grade: 'high' }), 'workspace').getHex()).toBe(CLOUD_WORKSPACE)
  })
})
