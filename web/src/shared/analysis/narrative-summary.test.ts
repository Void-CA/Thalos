import { describe, it, expect } from 'vitest'
import { buildNarrativeSummary } from './narrative-summary'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'

/**
 * intelligible-repair-loop — narrative builder invariant tests (task 1.1).
 * NOT snapshots: every assertion checks a grounded property of the derived
 * narrative (headline risk tier, region evidence traceability, factor
 * grounding, recommendation_context presence), so the copy can evolve without
 * re-baselining goldens.
 *
 * Grounding invariants under test (user-review, encoded in tasks.md):
 * - headline reflects the risk tier verbatim;
 * - a critical verdict + problem region cites criticality AND region evidence;
 * - every `primary_factors[].key` maps to an evidence key PRESENT in the input
 *   (traceability — the UI never invents a factor);
 * - `recommendation_context` is null when the assessment references no
 *   recommendations;
 * - no factor/key absent from the input evidence is ever asserted.
 *
 * UX redesign (binding brief): the summary reads like a human verdict —
 * plain English, no raw rule ids, no raw evidence keys, human factor labels
 * derived from evidence value + risk direction.
 */

const baseAssessment: AssessmentWire = {
  risk: 'low',
  quality: 0.82,
  triggered_rules: [],
  evidence: {
    manipulability: 0.75,
    singularity_proximity: 0.2,
    collision_clearance: 0.6,
  },
  recommendations: [],
  trace: [],
}

const criticalRegion: ProblemRegionWire = {
  id: 1,
  kind: 'singularity',
  severity: 'critical',
  waypoint_start: 10,
  waypoint_end: 20,
  waypoint_count: 11,
  explanation: {
    cause: 'Singularity near waypoint 10',
    consequence: 'Tool flips near the goal',
    recommended_strategies: ['Joint centering'],
    confidence: 0.9,
  },
}

describe('buildNarrativeSummary — headline (risk tier)', () => {
  it('says low when the risk is low', () => {
    const narrative = buildNarrativeSummary({ ...baseAssessment, risk: 'low' }, [])
    expect(narrative.headline.toLowerCase()).toContain('low')
  })

  it('labels medium, high and critical verdicts with their own tier', () => {
    expect(
      buildNarrativeSummary({ ...baseAssessment, risk: 'medium' }, []).headline.toLowerCase(),
    ).toContain('medium')
    expect(
      buildNarrativeSummary({ ...baseAssessment, risk: 'high' }, []).headline.toLowerCase(),
    ).toContain('high')
    expect(
      buildNarrativeSummary({ ...baseAssessment, risk: 'critical' }, []).headline.toLowerCase(),
    ).toContain('critical')
  })
})

describe('buildNarrativeSummary — summary grounding (critical + region)', () => {
  it('cites the criticality and the region evidence (cause + human span) when a critical verdict meets a region', () => {
    const narrative = buildNarrativeSummary(
      { ...baseAssessment, risk: 'critical' },
      [criticalRegion],
    )
    expect(narrative.summary.toLowerCase()).toContain('critical')
    expect(narrative.summary).toContain('Singularity near waypoint 10')
    expect(narrative.summary).toContain('waypoints 10\u201320')
  })

  it('keeps the summary silent about evidence keys absent from the input', () => {
    const narrative = buildNarrativeSummary(
      { ...baseAssessment, evidence: { manipulability: 0.2 } },
      [],
    )
    expect(narrative.summary).not.toContain('singularity_proximity')
    expect(narrative.summary).not.toContain('collision_clearance')
  })

  it('stays within 2-4 sentences', () => {
    const narrative = buildNarrativeSummary(
      { ...baseAssessment, risk: 'high' },
      [criticalRegion, criticalRegion, criticalRegion],
    )
    const sentences = narrative.summary.match(/[^.!?]+[.!?]/g) ?? []
    expect(sentences.length).toBeGreaterThanOrEqual(2)
    expect(sentences.length).toBeLessThanOrEqual(4)
  })
})

describe('buildNarrativeSummary — human phrasing (UX redesign)', () => {
  it('phrases the summary in plain English with no raw rule ids or raw evidence keys', () => {
    const narrative = buildNarrativeSummary(
      {
        ...baseAssessment,
        risk: 'medium',
        triggered_rules: [
          { id: 'R09_near_singularity', category: 'singularity', priority: 3 },
          { id: 'R10_manipulability_high', category: 'manipulability', priority: 2 },
        ],
        evidence: {
          singularity_proximity: 0.5,
          manipulability: 0.649,
          collision_clearance: 0.6,
        },
      },
      [],
    )
    expect(narrative.summary.toLowerCase()).toContain('a singular event was detected')
    expect(narrative.summary.toLowerCase()).toContain('manipulability is moderate')
    // No raw rule ids, no snake_case evidence keys, no rules-triggered sentence.
    expect(narrative.summary).not.toContain('R09_near_singularity')
    expect(narrative.summary).not.toContain('R10_manipulability_high')
    expect(narrative.summary).not.toContain('singularity_proximity')
    expect(narrative.summary).not.toMatch(/R\d\d_[a-z_]+/)
    expect(narrative.summary).not.toMatch(/triggered/i)
  })

  it('labels the primary factors humanly from the evidence value + direction', () => {
    const narrative = buildNarrativeSummary(
      {
        ...baseAssessment,
        evidence: {
          singularity_proximity: 0.5,
          manipulability: 0.649,
          collision_clearance: -0.05,
        },
      },
      [],
    )
    const labels = narrative.primary_factors.map((f) => f.label)
    expect(labels).toContain('Singular event')
    expect(labels).toContain('Moderate manipulability')
    expect(labels).toContain('Collision danger')
    // No raw key ever becomes a visible label.
    expect(labels).not.toContain('singularity_proximity')
  })

  it('omits the triggered-rules sentence even when rules fired', () => {
    const narrative = buildNarrativeSummary(
      {
        ...baseAssessment,
        triggered_rules: [{ id: 'R01_collision_danger', category: 'collision', priority: 10 }],
        evidence: {},
      },
      [],
    )
    expect(narrative.summary).not.toMatch(/rule/i)
  })
})

describe('buildNarrativeSummary — primary factors traceability', () => {
  it('maps every primary factor key to an evidence key present in the input', () => {
    const evidence = { manipulability: 0.2, singularity_proximity: 0.4 }
    const narrative = buildNarrativeSummary({ ...baseAssessment, evidence }, [])
    expect(narrative.primary_factors.length).toBeGreaterThan(0)
    for (const factor of narrative.primary_factors) {
      expect(Object.prototype.hasOwnProperty.call(evidence, factor.key)).toBe(true)
    }
  })

  it('ranks the most problematic evidence first (low manipulability beats clean collision clearance)', () => {
    const narrative = buildNarrativeSummary(
      { ...baseAssessment, evidence: { manipulability: 0.1, collision_clearance: 0.9 } },
      [],
    )
    expect(narrative.primary_factors[0].key).toBe('manipulability')
  })

  it('produces no factors when the assessment carries no evidence', () => {
    const narrative = buildNarrativeSummary({ ...baseAssessment, evidence: {} }, [])
    expect(narrative.primary_factors).toEqual([])
  })
})

describe('buildNarrativeSummary — recommendation context', () => {
  it('is null when the assessment references no recommendations', () => {
    expect(buildNarrativeSummary(baseAssessment, []).recommendation_context).toBeNull()
  })

  it('mentions the repair recommendations when the assessment references them', () => {
    const narrative = buildNarrativeSummary(
      {
        ...baseAssessment,
        recommendations: [
          {
            action_kind: 'Manipulability',
            region_id: 1,
            rationale: 'Improve manipulability near the flagged region.',
          },
        ],
      },
      [],
    )
    expect(narrative.recommendation_context).not.toBeNull()
    expect(narrative.recommendation_context).toMatch(/1 repair recommendation/i)
  })
})
