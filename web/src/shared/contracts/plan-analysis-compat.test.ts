import { describe, expect, it } from 'vitest'
import {
  toLegacyAnalysis,
  type AnalysisReportWire,
} from '@/shared/contracts/plan-analysis-compat'

/**
 * Contract tests — PR 7b temporal wire compatibility (cambio A removal gate).
 *
 * The backend /plan/analyze wire is now the canonical AnalysisReport
 * projection (observations[]/actions[]/metrics[]/summary, spec
 * motion-plan-endpoint). The legacy consumers (analysis store) still expect
 * the OLD contract shape (waypoints/findings/recommendations/health_score).
 *
 * These tests pin the C5 functional equivalence: given a wire payload shaped
 * EXACTLY as thalos_api serializes it, the adapter must produce the observable
 * behavior the old contract provided — same regions, same recommendations,
 * same score, same order — as a pure `wire → legacy` projection (C2: the
 * canonical model never knows the legacy shape).
 */

/** The wire payload as the backend actually serializes it (mirror of
 *  `PlanAnalysisResponse::from_report` in
 *  backend/crates/thalos-api/src/features/plan_analysis/dto.rs). */
const wirePayload = `{
  "artifact": { "kind": "MotionPlan", "id": "mp-1" },
  "observations": [
    {
      "id": 1, "kind": "LowManipulability", "severity": "Warning",
      "artifact": { "kind": "MotionPlan", "id": "mp-1" },
      "location": { "Waypoint": 3 },
      "attributes": { "value": { "Number": 0.21 }, "threshold": { "Number": 0.3 } },
      "causes": [], "related": []
    },
    {
      "id": 2, "kind": "NearSingularity", "severity": "Warning",
      "artifact": { "kind": "MotionPlan", "id": "mp-1" },
      "location": { "Waypoint": 5 },
      "attributes": { "value": { "Number": 150.0 }, "threshold": { "Number": 100.0 } },
      "causes": [], "related": []
    },
    {
      "id": 3, "kind": "Singularity", "severity": "Error",
      "artifact": { "kind": "MotionPlan", "id": "mp-1" },
      "location": { "Waypoint": 7 },
      "attributes": { "value": { "Number": 2000.0 }, "threshold": { "Number": 1000.0 } },
      "causes": [], "related": []
    },
    {
      "id": 4, "kind": "CollisionRisk", "severity": "Error",
      "artifact": { "kind": "MotionPlan", "id": "mp-1" },
      "location": { "Timestamp": 2 },
      "attributes": { "value": { "Number": -0.001 }, "threshold": { "Number": 0.0 } },
      "causes": [], "related": []
    }
  ],
  "actions": [
    { "id": 1, "kind": "Singularity", "target_observation": 3, "priority": "High", "impact": "High", "parameters": {} },
    { "id": 2, "kind": "Manipulability", "target_observation": 1, "priority": "Medium", "impact": "Medium", "parameters": {} }
  ],
  "metrics": {},
  "summary": {
    "quality_index": 0.4, "score": 40, "grade": "Poor",
    "observation_count": 4,
    "severity_distribution": { "Error": 2, "Warning": 2 }
  },
  "problem_regions": [
    {
      "id": 0, "kind": "singularity", "severity": "error",
      "waypoint_start": 5, "waypoint_end": 7, "waypoint_count": 3,
      "metrics": { "waypoint_count": 3, "average_value": null, "min_value": null, "max_value": null, "error_count": 1, "warning_count": 1 },
      "explanation": { "cause": "Singularity risk", "consequence": "Loss of dexterity", "recommended_strategies": ["Joint centering"], "confidence": 0.9 },
      "confidence": null, "recommended_strategies": []
    }
  ]
}`

describe('toLegacyAnalysis — C5 functional equivalence (wire → legacy)', () => {
  const wire = JSON.parse(wirePayload) as AnalysisReportWire
  const legacy = toLegacyAnalysis(wire)

  it('derives findings from observations preserving wire order, severity and anchors', () => {
    expect(legacy.findings).toHaveLength(4)
    // Same order as the wire observations (C5: same order when it matters).
    expect(legacy.findings.map(f => f.kind)).toEqual([
      'LowManipulability', 'NearSingularity', 'Singularity', 'CollisionRisk',
    ])
    const [lowManip, near, singular, collision] = legacy.findings
    // Severity: lowercase legacy convention ('warning'/'error').
    expect(lowManip.severity).toBe('warning')
    expect(singular.severity).toBe('error')
    // Waypoint anchor from location.Waypoint; non-waypoint location → null.
    expect(lowManip.waypoint).toBe(3)
    expect(near.waypoint).toBe(5)
    expect(collision.waypoint).toBeNull()
    // Value projected from the typed attributes ('value' key).
    expect(lowManip.value).toBe(0.21)
    expect(singular.value).toBe(2000)
    expect(collision.value).toBe(-0.001)
    // I1: presentation is reconstructed deterministically at the boundary.
    expect(lowManip.message).toBe('LowManipulability at waypoint 3 (value: 0.21)')
    expect(singular.message).toBe('Singularity at waypoint 7 (value: 2000)')
    expect(collision.message).toBe('CollisionRisk (value: -0.001)')
  })

  it('projects actions into recommendations with impact and target waypoint', () => {
    expect(legacy.recommendations).toHaveLength(2)
    expect(legacy.recommendations.map(r => r.kind)).toEqual(['Singularity', 'Manipulability'])
    const [singularity, manipulability] = legacy.recommendations
    expect(singularity.impact).toBe('high')
    // Waypoint resolved through the action's target observation (I5).
    expect(singularity.waypoint).toBe(7) // target_observation 3 → waypoint 7
    expect(manipulability.waypoint).toBe(3) // target_observation 1 → waypoint 3
    expect(singularity.message).toBe('Singularity remediation targeting observation 3')
  })

  it('maps score from quality_index × 100 with legacy status/message', () => {
    expect(legacy.summary.score).toBe(40) // quality_index 0.4 → score 40
    expect(legacy.summary.grade).toBe('Poor')
    expect(legacy.summary.status).toBe('error') // any Error observation → 'error'
    expect(legacy.summary.message).toBe('Issues found that prevent safe execution.')
    expect(legacy.health_score).toBe(0.4)
  })

  it('passes problem_regions through unchanged (same regions, same order)', () => {
    expect(legacy.problem_regions).toEqual(wire.problem_regions)
    expect(legacy.problem_regions?.[0]).toMatchObject({
      id: 0, kind: 'singularity', waypoint_start: 5, waypoint_end: 7,
    })
  })

  it('derives per-waypoint entries sorted by index from Waypoint-located observations', () => {
    expect(legacy.waypoints.map(w => w.index)).toEqual([3, 5, 7])
    expect(legacy.waypoints[0]).toEqual({
      index: 3,
      severity: 'warning',
      manipulability: 0.21, // LowManipulability carries its value
      singularity_state: null,
      clearance: null,
    })
    expect(legacy.waypoints[1].singularity_state).toBe('near')
    expect(legacy.waypoints[2]).toEqual({
      index: 7,
      severity: 'critical',
      manipulability: null,
      singularity_state: 'singular',
      clearance: null,
    })
  })

  it('derives legacy metrics best-effort from observations and wire metrics', () => {
    expect(legacy.metrics.near_singular_count).toBe(1)
    expect(legacy.metrics.singular_count).toBe(1)
    expect(legacy.metrics.has_collisions).toBe(true) // CollisionRisk observation
    expect(legacy.metrics.waypoint_count).toBe(8) // max observed waypoint index + 1
    expect(legacy.metrics.duration).toBe(0) // not carried on the wire
    expect(legacy.metrics.average_manipulability).toBeNull()
    expect(legacy.metrics.min_collision_distance).toBeNull()
  })
})

describe('toLegacyAnalysis — status derivation and edge cases', () => {
  function report(overrides: Partial<AnalysisReportWire>): AnalysisReportWire {
    return {
      artifact: { kind: 'MotionPlan', id: 'mp-1' },
      observations: [],
      actions: [],
      metrics: {},
      summary: {
        quality_index: 1,
        score: 100,
        grade: 'Excellent',
        observation_count: 0,
        severity_distribution: {},
      },
      ...overrides,
    }
  }

  it('clean report → ok status, perfect score, empty legacy collections', () => {
    const legacy = toLegacyAnalysis(report({}))
    expect(legacy.summary.status).toBe('ok')
    expect(legacy.summary.score).toBe(100)
    expect(legacy.summary.message).toBe('Trajectory is valid. No issues detected.')
    expect(legacy.health_score).toBe(1)
    expect(legacy.findings).toEqual([])
    expect(legacy.recommendations).toEqual([])
    expect(legacy.waypoints).toEqual([])
    expect(legacy.problem_regions).toBeUndefined()
    expect(legacy.metrics).toEqual({
      duration: 0,
      waypoint_count: 0,
      average_manipulability: null,
      near_singular_count: 0,
      singular_count: 0,
      min_collision_distance: null,
      has_collisions: false,
    })
  })

  it('warning-only report → warning status with warning template', () => {
    const legacy = toLegacyAnalysis(
      report({
        observations: [{
          id: 1, kind: 'NearSingularity', severity: 'Warning',
          artifact: { kind: 'MotionPlan', id: 'mp-1' },
          location: { Waypoint: 1 },
          attributes: { value: { Number: 150 }, threshold: { Number: 100 } },
          causes: [], related: [],
        }],
        summary: {
          quality_index: 0.9, score: 90, grade: 'Good',
          observation_count: 1,
          severity_distribution: { Warning: 1 },
        },
      }),
    )
    expect(legacy.summary.status).toBe('warning')
    expect(legacy.summary.message).toBe('Trajectory is valid but has room for improvement.')
  })

  it('error observation wins over warning for status', () => {
    const legacy = toLegacyAnalysis(
      report({
        observations: [
          { id: 1, kind: 'Singularity', severity: 'Error', artifact: { kind: 'MotionPlan', id: 'mp-1' }, location: { Waypoint: 2 }, attributes: {}, causes: [], related: [] },
          { id: 2, kind: 'NearSingularity', severity: 'Warning', artifact: { kind: 'MotionPlan', id: 'mp-1' }, location: { Waypoint: 1 }, attributes: {}, causes: [], related: [] },
        ],
        summary: {
          quality_index: 0.3, score: 30, grade: 'Poor',
          observation_count: 2,
          severity_distribution: { Error: 1, Warning: 1 },
        },
      }),
    )
    expect(legacy.summary.status).toBe('error')
  })

  it('wire metrics keys win over derived counts when the backend provides them', () => {
    const legacy = toLegacyAnalysis(
      report({
        observations: [{
          id: 1, kind: 'NearSingularity', severity: 'Warning',
          artifact: { kind: 'MotionPlan', id: 'mp-1' },
          location: { Waypoint: 0 },
          attributes: {}, causes: [], related: [],
        }],
        metrics: { near_singular_count: 3, waypoint_count: 12, duration: 4.5 },
      }),
    )
    expect(legacy.metrics.near_singular_count).toBe(3)
    expect(legacy.metrics.waypoint_count).toBe(12)
    expect(legacy.metrics.duration).toBe(4.5)
  })
})
