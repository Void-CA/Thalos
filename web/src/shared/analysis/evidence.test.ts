import { describe, it, expect } from 'vitest'
import {
  evidenceReading,
  evidenceDirection,
  humanizeKey,
  VARIABLE_ORDER,
} from './evidence'

/**
 * Evidence semantics — the human reading of the fuzzy evidence variables.
 * Thresholds are anchored to the thalos-intelligence KB (kb.rs): manipulability
 * < 0.3 low, singularity proximity ≥ 0.3 near, collision clearance (meters)
 * ≤ 0 danger / < 0.05 reduced / ≥ 0.05 safe, trajectory complexity ≥ 10 very
 * high. Unknown keys → null (never an invented reading).
 */

describe('evidenceReading — manipulability (0..1, lower worse)', () => {
  it('reads below 0.3 as Low/danger', () => {
    expect(evidenceReading('manipulability', 0.1)).toEqual(
      expect.objectContaining({ reading: 'Low', tone: 'danger', chipLabel: 'Low manipulability' }),
    )
  })

  it('reads 0.3–0.7 as Moderate/warn', () => {
    expect(evidenceReading('manipulability', 0.5)).toEqual(
      expect.objectContaining({ reading: 'Moderate', tone: 'warn' }),
    )
  })

  it('reads above 0.7 as Good/good', () => {
    expect(evidenceReading('manipulability', 0.75)).toEqual(
      expect.objectContaining({ reading: 'Good', tone: 'good' }),
    )
  })
})

describe('evidenceReading — collision clearance (meters, lower worse)', () => {
  it('reads 0.6 m as Safe/good', () => {
    expect(evidenceReading('collision_clearance', 0.6)).toEqual(
      expect.objectContaining({ reading: 'Safe', tone: 'good', unit: 'm' }),
    )
  })

  it('reads 0.02 m as Reduced/warn', () => {
    expect(evidenceReading('collision_clearance', 0.02)).toEqual(
      expect.objectContaining({ reading: 'Reduced', tone: 'warn' }),
    )
  })

  it('reads negative clearance as Danger', () => {
    expect(evidenceReading('collision_clearance', -0.1)).toEqual(
      expect.objectContaining({ reading: 'Danger', tone: 'danger' }),
    )
  })
})

describe('evidenceReading — singularity proximity (0..1, higher worse)', () => {
  it('reads 0.044 as Low/good', () => {
    expect(evidenceReading('singularity_proximity', 0.044)).toEqual(
      expect.objectContaining({ reading: 'Low', tone: 'good' }),
    )
  })

  it('reads 0.2 as Moderate/warn', () => {
    expect(evidenceReading('singularity_proximity', 0.2)).toEqual(
      expect.objectContaining({ reading: 'Moderate', tone: 'warn' }),
    )
  })

  it('reads 0.5 as Near/danger', () => {
    expect(evidenceReading('singularity_proximity', 0.5)).toEqual(
      expect.objectContaining({ reading: 'Near', tone: 'danger' }),
    )
  })
})

describe('evidenceReading — trajectory complexity (index, higher worse)', () => {
  it('reads 100.44 as Very high/danger', () => {
    expect(evidenceReading('trajectory_complexity', 100.44)).toEqual(
      expect.objectContaining({ reading: 'Very high', tone: 'danger' }),
    )
  })

  it('reads 7 as Moderate/warn', () => {
    expect(evidenceReading('trajectory_complexity', 7)).toEqual(
      expect.objectContaining({ reading: 'Moderate', tone: 'warn' }),
    )
  })

  it('reads 2 as Low/good', () => {
    expect(evidenceReading('trajectory_complexity', 2)).toEqual(
      expect.objectContaining({ reading: 'Low', tone: 'good' }),
    )
  })
})

describe('evidenceReading — unknown keys', () => {
  it('returns null so consumers show the value only (never an invented reading)', () => {
    expect(evidenceReading('collision_danger', 1.0)).toBeNull()
    expect(evidenceReading('complexity_high', 1.0)).toBeNull()
    expect(evidenceReading('unknown_metric', 0.5)).toBeNull()
  })
})

describe('evidenceDirection — risk contribution direction', () => {
  it('marks lower-is-worse and higher-is-worse variables', () => {
    expect(evidenceDirection('manipulability')).toBe(-1)
    expect(evidenceDirection('collision_clearance')).toBe(-1)
    expect(evidenceDirection('singularity_proximity')).toBe(1)
    expect(evidenceDirection('trajectory_complexity')).toBe(1)
    expect(evidenceDirection('collision_danger')).toBe(0)
  })
})

describe('VARIABLE_ORDER — canonical display order', () => {
  it('lists exactly the four canonical variables in a fixed order', () => {
    expect(VARIABLE_ORDER).toEqual([
      'manipulability',
      'singularity_proximity',
      'collision_clearance',
      'trajectory_complexity',
    ])
  })
})

describe('humanizeKey', () => {
  it('turns snake_case wire keys into title case', () => {
    expect(humanizeKey('collision_danger')).toBe('Collision danger')
    expect(humanizeKey('R12_safe_plan')).toBe('R12 safe plan')
  })
})
