import { describe, it, expect } from 'vitest'
import {
  RULE_LABELS,
  POSITIVE_RULES,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ruleLabel,
  isPositiveRule,
  bindingPhrase,
  consequentPhrase,
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

describe('bindingPhrase — human "why" from the trace bindings', () => {
  it('reads the wire shape: set embedded in the key, membership degree as value', () => {
    expect(bindingPhrase({ 'Manipulability IS low': '0.667' })).toBe('Manipulability is low')
    expect(bindingPhrase({ 'CollisionClearance IS danger': '1.000' })).toBe(
      'Collision clearance is danger',
    )
    expect(bindingPhrase({ 'SingularityProximity IS high': '0.420' })).toBe(
      'Singularity proximity is high',
    )
    expect(bindingPhrase({ 'TrajectoryComplexity IS high': '0.890' })).toBe(
      'Trajectory complexity is high',
    )
  })

  it('reads the {variable: set} shape defensively', () => {
    expect(bindingPhrase({ manipulability: 'low' })).toBe('Manipulability is low')
    expect(bindingPhrase({ trajectory_complexity: 'high' })).toBe('Trajectory complexity is high')
  })

  it('reads FactEquals bindings as facts', () => {
    expect(bindingPhrase({ safe_clearance: 'true' })).toBe('safe clearance is true')
    expect(bindingPhrase({ danger_zone: 'false' })).toBe('danger zone is false')
  })

  it('joins multiple bindings cleanly in insertion order', () => {
    expect(
      bindingPhrase({
        safe_clearance: 'true',
        'SingularityProximity IS low': '1.000',
        'Manipulability IS high': '1.000',
      }),
    ).toBe('safe clearance is true; Singularity proximity is low; Manipulability is high')
  })

  it('falls back to a raw key=value pair for an unreadable binding', () => {
    expect(bindingPhrase({ weird_key: '0.5' })).toBe('Weird key = 0.5')
  })

  it('returns "—" for empty bindings', () => {
    expect(bindingPhrase({})).toBe('—')
  })
})

describe('consequentPhrase — human "what" from the derived output', () => {
  it('reads KB facts as marked consequences', () => {
    expect(consequentPhrase({ danger_zone: true })).toBe('marked danger zone')
    expect(consequentPhrase({ safe_clearance: true })).toBe('marked safe clearance')
    expect(consequentPhrase({ near_singularity: true })).toBe('marked near singularity')
    expect(consequentPhrase({ good_manipulability: true })).toBe('marked good manipulability')
  })

  it('reads evidence-mark keys the KB raises alongside derived facts', () => {
    expect(consequentPhrase({ complexity_high: true })).toBe('marked high complexity')
    expect(consequentPhrase({ manipulability_low: true })).toBe('marked low manipulability')
    expect(consequentPhrase({ collision_danger: true })).toBe('marked collision danger')
  })

  it('reads risk-set keys as a risk raise (defensive)', () => {
    expect(consequentPhrase({ medium: true })).toBe('raised risk to medium')
    expect(consequentPhrase({ critical: true })).toBe('raised risk to critical')
  })

  it('reads false entries as cleared, unknown keys humanized', () => {
    expect(consequentPhrase({ danger_zone: false })).toBe('cleared danger zone')
    expect(consequentPhrase({ mystery_flag: true })).toBe('marked mystery flag')
  })

  it('joins multiple consequents and returns "—" for empty', () => {
    expect(consequentPhrase({ danger_zone: true, complexity_high: true })).toBe(
      'marked danger zone, marked high complexity',
    )
    expect(consequentPhrase({})).toBe('—')
  })
})
