import { describe, it, expect } from 'vitest'
import {
  evidenceReading,
  evidenceDirection,
  humanizeKey,
  variableLabel,
  VARIABLE_ORDER,
} from './evidence'

/**
 * Evidence semantics — the human reading of the fuzzy evidence variables.
 * Thresholds are anchored to the thalos-intelligence KB (kb.rs): manipulability
 * < 0.3 low, singularity LOCALIZED presence score (0.0 none / 0.15 near /
 * 0.5 singular event), collision clearance (meters) ≤ 0 danger / < 0.05
 * reduced / ≥ 0.05 safe. Unknown keys → null (never an invented reading).
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

describe('evidenceReading — singularity (localized presence score, higher worse)', () => {
  it('reads 0.0 as None/good', () => {
    expect(evidenceReading('singularity_proximity', 0.0)).toEqual(
      expect.objectContaining({ reading: 'None', tone: 'good' }),
    )
  })

  it('reads 0.15 (near-singular only) as Near/warn', () => {
    expect(evidenceReading('singularity_proximity', 0.15)).toEqual(
      expect.objectContaining({ reading: 'Near', tone: 'warn' }),
    )
  })

  it('reads 0.5 (a singular event) as Singular/danger', () => {
    expect(evidenceReading('singularity_proximity', 0.5)).toEqual(
      expect.objectContaining({
        reading: 'Singular',
        tone: 'danger',
        chipLabel: 'Singular event',
      }),
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
    expect(evidenceDirection('collision_danger')).toBe(0)
  })
})

describe('VARIABLE_ORDER — canonical display order', () => {
  it('lists exactly the three canonical variables in a fixed order', () => {
    expect(VARIABLE_ORDER).toEqual([
      'manipulability',
      'singularity_proximity',
      'collision_clearance',
    ])
  })
})

describe('humanizeKey', () => {
  it('turns snake_case wire keys into title case', () => {
    expect(humanizeKey('collision_danger')).toBe('Collision danger')
    expect(humanizeKey('R12_safe_plan')).toBe('R12 safe plan')
  })
})

describe('variableLabel — raw variable name → human label', () => {
  it('maps the engine Debug names used in trace binding keys', () => {
    expect(variableLabel('Manipulability')).toBe('Manipulability')
    expect(variableLabel('SingularityProximity')).toBe('Singularity')
    expect(variableLabel('CollisionClearance')).toBe('Collision clearance')
  })

  it('maps the wire snake_case evidence keys', () => {
    expect(variableLabel('manipulability')).toBe('Manipulability')
    expect(variableLabel('singularity_proximity')).toBe('Singularity')
  })

  it('falls back to a humanized label for unknown names', () => {
    expect(variableLabel('unknown_thing')).toBe('Unknown thing')
  })
})
