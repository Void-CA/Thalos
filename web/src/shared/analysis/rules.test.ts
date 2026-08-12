import { describe, it, expect } from 'vitest'
import {
  RULE_LABELS,
  POSITIVE_RULES,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ruleLabel,
  isPositiveRule,
} from './rules'

/**
 * Rule semantics — human labels for the frozen 12-rule KB
 * (backend crates/thalos-intelligence/src/kb.rs). Every KB id must map to a
 * human label; unknown ids fall back to a humanized version.
 */

describe('RULE_LABELS — covers the full KB rule base', () => {
  it('labels all 12 frozen KB rules', () => {
    const kbIds = [
      'R01_collision_danger',
      'R02_collision_near',
      'R03_collision_danger_evidence',
      'R04_singularity_medium',
      'R05_manipulability_medium',
      'R06_high_complexity',
      'R07_low_manipulability',
      'R08_safe_clearance',
      'R09_near_singularity',
      'R10_manipulability_high',
      'R11_danger_zone',
      'R12_safe_plan',
    ]
    for (const id of kbIds) {
      expect(RULE_LABELS[id], `missing label for ${id}`).toBeTruthy()
    }
  })

  it('maps the headline rules to the binding brief labels', () => {
    expect(RULE_LABELS.R01_collision_danger).toBe('Collision danger')
    expect(RULE_LABELS.R02_collision_near).toBe('Near collision')
    expect(RULE_LABELS.R06_high_complexity).toBe('High trajectory complexity')
    expect(RULE_LABELS.R08_safe_clearance).toBe('Safe clearance')
    expect(RULE_LABELS.R10_manipulability_high).toBe('High manipulability')
    expect(RULE_LABELS.R12_safe_plan).toBe('Safe plan')
  })
})

describe('isPositiveRule — safe rules never read as warnings', () => {
  it('marks the safe/positive rules', () => {
    expect(isPositiveRule('R08_safe_clearance')).toBe(true)
    expect(isPositiveRule('R10_manipulability_high')).toBe(true)
    expect(isPositiveRule('R12_safe_plan')).toBe(true)
  })

  it('does not mark problem rules (determined per-rule, not by category)', () => {
    expect(isPositiveRule('R01_collision_danger')).toBe(false)
    expect(isPositiveRule('R07_low_manipulability')).toBe(false)
    expect(isPositiveRule('R11_danger_zone')).toBe(false)
    // Same category (Manipulability) as a positive rule — must stay distinct.
    expect(isPositiveRule('R05_manipulability_medium')).toBe(false)
    expect(POSITIVE_RULES.size).toBe(3)
  })
})

describe('ruleLabel — fallback for unknown ids', () => {
  it('returns the mapped label for known rules', () => {
    expect(ruleLabel('R01_collision_danger')).toBe('Collision danger')
  })

  it('humanizes unknown ids so the UI never shows a raw moniker', () => {
    expect(ruleLabel('R99_unknown_rule')).toBe('R99 unknown rule')
    expect(ruleLabel('R12_complexity')).toBe('R12 complexity')
  })
})

describe('CATEGORY_LABELS / CATEGORY_ORDER — grouping', () => {
  it('labels all four reasoning categories', () => {
    expect(CATEGORY_LABELS.collision).toBe('Collision')
    expect(CATEGORY_LABELS.singularity).toBe('Singularity')
    expect(CATEGORY_LABELS.manipulability).toBe('Manipulability')
    expect(CATEGORY_LABELS.trajectory).toBe('Trajectory')
  })

  it('has a stable display order', () => {
    expect(CATEGORY_ORDER).toEqual([
      'collision',
      'singularity',
      'manipulability',
      'trajectory',
    ])
  })
})
