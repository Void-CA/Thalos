// TODO(change-A): remove compatibility layer
// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY compatibility adapter — the ONLY bridge between the new
// AnalysisReport wire contract (POST /plan/analyze, PR 7a) and the legacy
// analysis contract the current frontend consumes (waypoints/findings/
// recommendations/health_score). It exists to keep the pre-cambio-A UI
// working unchanged while the backend serves the clean canonical shape.
//
// Removal gate: delete this module (and its contract test) when cambio A
// ships — the new UI consumes observations/actions directly. At that point
// `plan-analysis-api.ts` reverts to returning the wire type as-is and the
// legacy type re-exports in `features/analysis/api/plan-analysis.types.ts`
// are removed. The backend NEVER knows this module exists (I6: the wire is a
// pure projection of the domain AnalysisReport).
//
// Direction (C2): strictly `AnalysisReportWire → LegacyAnalysisResponse`.
// There is NO reverse conversion — the canonical model never learns the
// legacy shape.
//
// Fidelity notes (C5 — functional, not structural equivalence):
// - `problem_regions` pass through unchanged (same regions, same order).
// - `recommendations` project actions (impact lowercased, waypoint resolved
//   through the action's target observation, I5), wire order preserved.
// - `summary.score` = the wire score (quality_index × 100) — the canonical
//   single quality measure (I7); the legacy heuristic score is NOT recreated.
// - `summary.status`/`message` are presentation (I1): reconstructed here from
//   observation severities with the legacy templates.
// - `findings.message`/`recommendations.message` are deterministic
//   presentation strings derived from the wire facts (I1) — not stored
//   anywhere in the domain.
// - `waypoints` are derived per observation anchored to a `Waypoint` location.
//   The new wire does not carry the per-waypoint technical stream, so the
//   trajectory coloring falls back to the component's graceful `nodata` path
//   when the sparse list cannot cover the full trajectory.
// - `metrics` is best-effort: the aggregator emits an empty map today, so
//   counts are derived from observations; wire keys win when present.

/** Externally-tagged `Location` enum as serialized by the backend
 *  (`{"Waypoint": 5}`, `{"Timestamp": 2}`, …). */
export type WireLocation =
  | { Waypoint: number }
  | { Timestamp: number }
  | { Joint: unknown }
  | { Operation: unknown }
  | { Region: unknown }
  | { Object: unknown }
  | { Frame: unknown }

/** Typed `AttributeValue` enum (D5), externally tagged on the wire. */
export interface WireAttributeValue {
  Number?: number
  Text?: string
  Bool?: boolean
  Integer?: number
}

/** An observation as the backend projects it (I2: machine-readable facts). */
export interface AnalysisObservationWire {
  id: number
  kind: string
  severity: 'Error' | 'Warning' | 'Info'
  artifact: { kind: string; id: string }
  location: WireLocation
  attributes: Record<string, WireAttributeValue>
  causes: number[]
  related: number[]
}

/** A remediation action as the backend projects it (I5: targets by id). */
export interface AnalysisActionWire {
  id: number
  kind: string
  target_observation: number
  priority: string
  impact: string
  parameters: Record<string, unknown>
}

/** The canonical /plan/analyze wire payload — projection of the domain
 *  `AnalysisReport` (spec motion-plan-endpoint). */
export interface AnalysisReportWire {
  artifact: { kind: string; id: string }
  observations: AnalysisObservationWire[]
  actions: AnalysisActionWire[]
  metrics: Record<string, number>
  summary: {
    quality_index: number
    score: number
    grade: string
    observation_count: number
    severity_distribution: Record<string, number>
  }
  problem_regions?: unknown[]
}

// ─── Legacy contract shapes (what the current frontend consumes) ───────────

export type LegacyGrade = 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Invalid'
export type LegacyStatus = 'ok' | 'warning' | 'error'
export type LegacyWaypointSeverity = 'good' | 'warning' | 'critical'

export interface LegacySummary {
  status: LegacyStatus
  score: number
  grade: LegacyGrade
  message: string
}

export interface LegacyMetrics {
  duration: number
  waypoint_count: number
  average_manipulability: number | null
  near_singular_count: number
  singular_count: number
  min_collision_distance: number | null
  has_collisions: boolean
}

export interface LegacyWaypointAnalysis {
  index: number
  severity: LegacyWaypointSeverity
  manipulability: number | null
  singularity_state: 'normal' | 'near' | 'singular' | null
  clearance: number | null
}

export interface LegacyFinding {
  kind: string
  severity: string
  waypoint: number | null
  message: string
  value: number | null
}

export interface LegacyRecommendation {
  kind: string
  message: string
  impact: string
  waypoint: number | null
}

/** The legacy /plan/analyze response contract the current store consumes. */
export interface LegacyAnalysisResponse {
  summary: LegacySummary
  metrics: LegacyMetrics
  waypoints: LegacyWaypointAnalysis[]
  findings: LegacyFinding[]
  recommendations: LegacyRecommendation[]
  problem_regions?: unknown[]
  health_score: number
}

// ─── Adapter: AnalysisReportWire → LegacyAnalysisResponse (C2, one direction)

const LEGACY_STATUS_MESSAGES: Record<LegacyStatus, string> = {
  error: 'Issues found that prevent safe execution.',
  warning: 'Trajectory is valid but has room for improvement.',
  ok: 'Trajectory is valid. No issues detected.',
}

/** Waypoint anchor of a wire observation, or null for non-waypoint locations. */
function waypointOf(observation: AnalysisObservationWire): number | null {
  const location = observation.location
  return 'Waypoint' in location ? location.Waypoint : null
}

/** Numeric attribute value ('value'/'threshold' keys are the analyzer's). */
function numericAttribute(
  attributes: Record<string, WireAttributeValue>,
  key: string,
): number | null {
  const attribute = attributes[key]
  if (!attribute) return null
  return attribute.Number ?? attribute.Integer ?? null
}

/** Deterministic presentation message derived from the wire facts (I1). */
function findingMessage(observation: AnalysisObservationWire): string {
  const waypoint = waypointOf(observation)
  const value = numericAttribute(observation.attributes, 'value')
  let message = observation.kind
  if (waypoint !== null) message += ` at waypoint ${waypoint}`
  if (value !== null) message += ` (value: ${value})`
  return message
}

function legacyStatus(observations: AnalysisObservationWire[]): LegacyStatus {
  if (observations.some(o => o.severity === 'Error')) return 'error'
  if (observations.some(o => o.severity === 'Warning')) return 'warning'
  return 'ok'
}

function legacyMetrics(wire: AnalysisReportWire): LegacyMetrics {
  const wireMetrics = wire.metrics
  const waypointIndexes = wire.observations
    .map(waypointOf)
    .filter((index): index is number => index !== null)
  const hasCollisions = wire.observations.some(o => o.kind === 'CollisionRisk')
  return {
    duration: wireMetrics.duration ?? 0,
    waypoint_count:
      wireMetrics.waypoint_count ??
      (waypointIndexes.length > 0 ? Math.max(...waypointIndexes) + 1 : 0),
    average_manipulability: wireMetrics.average_manipulability ?? null,
    near_singular_count:
      wireMetrics.near_singular_count ??
      wire.observations.filter(o => o.kind === 'NearSingularity').length,
    singular_count:
      wireMetrics.singular_count ??
      wire.observations.filter(o => o.kind === 'Singularity').length,
    min_collision_distance: wireMetrics.min_collision_distance ?? null,
    has_collisions: hasCollisions,
  }
}

function legacyWaypoint(
  observation: AnalysisObservationWire,
): LegacyWaypointAnalysis | null {
  const waypoint = waypointOf(observation)
  if (waypoint === null) return null
  return {
    index: waypoint,
    severity:
      observation.severity === 'Error'
        ? 'critical'
        : observation.severity === 'Warning'
          ? 'warning'
          : 'good',
    manipulability:
      observation.kind === 'LowManipulability'
        ? numericAttribute(observation.attributes, 'value')
        : null,
    singularity_state:
      observation.kind === 'Singularity'
        ? 'singular'
        : observation.kind === 'NearSingularity'
          ? 'near'
          : null,
    clearance:
      observation.kind === 'CollisionRisk' || observation.kind === 'CollisionNear'
        ? numericAttribute(observation.attributes, 'value')
        : null,
  }
}

/**
 * Converts the canonical wire payload into the legacy contract shape.
 * Pure function: same wire → same legacy output (deterministic, side-effect
 * free). This is the ONLY place where the shape adaptation lives (C1).
 */
export function toLegacyAnalysis(wire: AnalysisReportWire): LegacyAnalysisResponse {
  const observationsById = new Map(wire.observations.map(o => [o.id, o]))
  const status = legacyStatus(wire.observations)

  const findings: LegacyFinding[] = wire.observations.map(observation => ({
    kind: observation.kind,
    severity: observation.severity.toLowerCase(),
    waypoint: waypointOf(observation),
    message: findingMessage(observation),
    value: numericAttribute(observation.attributes, 'value'),
  }))

  const recommendations: LegacyRecommendation[] = wire.actions.map(action => ({
    kind: action.kind,
    message: `${action.kind} remediation targeting observation ${action.target_observation}`,
    impact: action.impact.toLowerCase(),
    waypoint: observationsById.has(action.target_observation)
      ? waypointOf(observationsById.get(action.target_observation)!)
      : null,
  }))

  const waypoints = wire.observations
    .map(legacyWaypoint)
    .filter((entry): entry is LegacyWaypointAnalysis => entry !== null)
    .sort((a, b) => a.index - b.index)

  return {
    summary: {
      status,
      score: wire.summary.score,
      grade: wire.summary.grade as LegacyGrade,
      message: LEGACY_STATUS_MESSAGES[status],
    },
    metrics: legacyMetrics(wire),
    waypoints,
    findings,
    recommendations,
    problem_regions: wire.problem_regions,
    health_score: wire.summary.quality_index,
  }
}
