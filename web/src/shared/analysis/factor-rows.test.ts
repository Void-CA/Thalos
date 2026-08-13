import { describe, it, expect } from 'vitest'
import { factorRows, formatEvidenceValue } from './factor-rows'

/**
 * Factor rows — the structured "why" of the verdict. Pins:
 * - rows derive from the KB-anchored semantics (evidence.ts): human label,
 *   tone and reading, never a raw evidence key;
 * - ranking by risk contribution (direction-aware, clamped to [0,1]);
 * - unknown keys are excluded (never an invented reading);
 * - raw value always stays visible, formatted with the unit.
 */

describe('factorRows — ranking and derivation', () => {
  it('ranks known variables by risk contribution (desc) and derives label/tone/reading', () => {
    const rows = factorRows({
      manipulability: 0.0, // risk 1 - 0.0 = 1.0 — Low / danger
      singularity_proximity: 0.5, // risk 0.5 — Singular event / danger
      collision_clearance: 0.6, // risk 0.4 — Safe / good
    })
    expect(rows.map((row) => row.key)).toEqual([
      'manipulability',
      'singularity_proximity',
      'collision_clearance',
    ])
    expect(rows[0]).toMatchObject({
      label: 'Low manipulability',
      tone: 'danger',
      reading: 'Low',
      risk: 1,
    })
    expect(rows[1]).toMatchObject({
      label: 'Singular event',
      tone: 'danger',
      reading: 'Singular',
    })
  })

  it('marks safe values with a good tone and a low risk contribution', () => {
    const rows = factorRows({ collision_clearance: 0.6 })
    expect(rows[0]).toMatchObject({
      label: 'Safe clearance',
      tone: 'good',
      reading: 'Safe',
      risk: 0.4,
    })
  })
})

describe('factorRows — values and unknown keys', () => {
  it('formats the raw value with its unit where present', () => {
    const rows = factorRows({ collision_clearance: -0.1, manipulability: 0.65 })
    expect(rows.find((row) => row.key === 'collision_clearance')).toMatchObject({
      value: -0.1,
      displayValue: '-0.1 m',
    })
    expect(rows.find((row) => row.key === 'manipulability')).toMatchObject({
      displayValue: '0.65',
    })
  })

  it('excludes unknown evidence keys (never an invented reading)', () => {
    const rows = factorRows({ collision_danger: 1.0, manipulability: 0.75 })
    expect(rows.map((row) => row.key)).toEqual(['manipulability'])
  })

  it('returns an empty list for empty or fully-unknown evidence', () => {
    expect(factorRows({})).toEqual([])
    expect(factorRows({ unknown_metric: 0.5 })).toEqual([])
  })

  it('keeps the raw value and clamps the risk contribution to [0,1]', () => {
    const rows = factorRows({ manipulability: -0.5 })
    expect(rows[0].risk).toBe(1)
    expect(rows[0].value).toBe(-0.5)
  })
})

describe('formatEvidenceValue', () => {
  it('trims trailing zeros and appends the unit', () => {
    expect(formatEvidenceValue(12, null)).toBe('12')
    expect(formatEvidenceValue(0.2, null)).toBe('0.2')
    expect(formatEvidenceValue(0.6, 'm')).toBe('0.6 m')
    expect(formatEvidenceValue(-0.1, 'm')).toBe('-0.1 m')
    expect(formatEvidenceValue(100.44, null)).toBe('100.44')
  })
})
