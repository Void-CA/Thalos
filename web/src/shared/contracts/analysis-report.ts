/**
 * Canonical analysis contract — projection of the domain `AnalysisReport`
 * (analysis-model change). This is the ONLY wire shape the frontend consumes
 * for `/plan/analyze` (spec motion-plan-endpoint: "response SHALL be
 * AnalysisReport"; spec advisor-projection: the Advisor consumes the report).
 *
 * The compatibility layer that translated this into the legacy
 * waypoints/findings/recommendations/health_score shape was removed in
 * domain-areas S4 (ADR: ui-as-domain-projection — the UI projects the domain,
 * never an alternative representation).
 */

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

/** A problem region as the backend projects it (legacy representation kept on
 *  the wire for the transition; derived from observations via RegionGrouper +
 *  ProblemRegionsDtoAdapter — domain → DTO, never the reverse). */
export interface ProblemRegionWire {
  id: number
  kind: string
  severity: string
  waypoint_start: number
  waypoint_end: number
  waypoint_count: number
  metrics?: {
    waypoint_count: number
    average_value: number | null
    min_value: number | null
    max_value: number | null
    error_count: number
    warning_count: number
  } | null
  explanation?: {
    cause: string
    consequence: string
    recommended_strategies: string[]
    confidence: number
  } | null
  recommended_strategies?: string[]
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
  problem_regions?: ProblemRegionWire[]
}

// ─── Derived pure helpers (I3: interpretation derives from kind/severity) ───

/** Waypoint anchor of a wire observation, or null for non-waypoint locations. */
export function waypointOf(observation: AnalysisObservationWire): number | null {
  const location = observation.location
  return 'Waypoint' in location ? location.Waypoint : null
}

/** Numeric attribute value ('value'/'threshold' keys are the analyzer's). */
export function numericAttribute(
  attributes: Record<string, WireAttributeValue>,
  key: string,
): number | null {
  const attribute = attributes[key]
  if (!attribute) return null
  return attribute.Number ?? attribute.Integer ?? null
}

/** Counts of observations by severity (I7: severity_distribution from the report
 *  or derived from observations when the map is absent). */
export function severityCounts(report: AnalysisReportWire): {
  error: number
  warning: number
  info: number
} {
  const dist = report.summary.severity_distribution ?? {}
  const bySeverity = (key: string) =>
    (dist[key] ?? report.observations.filter(o => o.severity === key).length)
  return {
    error: bySeverity('Error'),
    warning: bySeverity('Warning'),
    info: bySeverity('Info'),
  }
}

/** Per-waypoint analysis view derived from observations anchored to a
 *  `Location::Waypoint` (I4: derived pure function — the store persists only
 *  the canonical report). Sparse coverage falls back to fewer entries; the
 *  trajectory coloring uses the graceful `nodata` path for uncovered points. */
export interface WaypointAnalysisView {
  index: number
  severity: 'good' | 'warning' | 'critical'
  manipulability: number | null
  singularity_state: 'normal' | 'near' | 'singular' | null
  clearance: number | null
}

export function waypointAnalysisFromReport(report: AnalysisReportWire): WaypointAnalysisView[] {
  const entries: WaypointAnalysisView[] = []
  for (const observation of report.observations) {
    const waypoint = waypointOf(observation)
    if (waypoint === null) continue
    entries.push({
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
    })
  }
  return entries.sort((a, b) => a.index - b.index)
}
