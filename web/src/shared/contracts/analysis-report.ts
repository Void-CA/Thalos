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

/** One manipulability point per analyzed waypoint (design P3, spec
 *  motion-plan-endpoint). Projection of `PlanAnalysis.waypoints[].manipulability`
 *  computed by the backend — the chart builder consumes this series verbatim
 *  (I2: the UI never recomputes manipulability). */
export interface ManipulabilityPointWire {
  /** 0-based waypoint index in the analyzed plan. */
  waypoint: number
  /** Trajectory time of the waypoint in seconds (additive — OPTIONAL for
   *  backward compatibility: older backends omit it, so consumers fall back
   *  to the waypoint index on the x axis). The honest temporal scale: waypoint
   *  index compresses dense segments (e.g. a trapezoidal MoveJ samples at 4×
   *  the spacing of a MoveL). */
  timestamp?: number
  /** Yoshikawa manipulability measure at that waypoint. */
  yoshikawa: number
  /** Jacobian determinant det(J·Jᵀ) at that waypoint (additive — OPTIONAL for
   *  backward compatibility: older backends omit it, so consumers must
   *  tolerate its absence). */
  det_jtj?: number
}

/** A remediation recommendation (spec recommendation-model "Wire Contract").
 *  Projection of `Recommendation { id, action, edit, status }` — the typed
 *  `edit` is a semantic plan command (design D1) that the Preview/Apply/Undo
 *  pipeline executes. The frontend treats `edit` as opaque in PR3 (Preview
 *  only) — Apply/Undo (PR4/PR5) consume it verbatim from the wire. */
export interface RecommendationWire {
  /** Recommendation id within the analysis report (1-based advisor counter). */
  id: number
  /** The remediation this recommendation proposes (I5: targets by id). */
  action: AnalysisActionWire
  /** Semantic plan command (serde externally-tagged `ProgramEdit` variant). */
  edit: Record<string, unknown>
  /** Availability (design D8): "available" | "unavailable"; omitted when
   *  not evaluated. Unavailable edits must not be applied (PR4 gates on it). */
  status?: 'available' | 'unavailable'
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
  /** Per-waypoint manipulability series (P3). OPTIONAL on the wire: the backend
   *  annotates it `#[serde(default, skip_serializing_if = "Vec::is_empty")]`,
   *  so old payloads and trivial plans omit it (I3 — additive delta). */
  manipulability_series?: ManipulabilityPointWire[]
  /** Remediation recommendations (PR2). OPTIONAL on the wire (additive, I3):
   *  old payloads omit the field; the advisor only produces recommendations
   *  when the analysis flow carries program + solver context. */
  recommendations?: RecommendationWire[]
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

/** The per-waypoint manipulability series, defaulting to `[]` when absent
 *  (I3: old payloads and trivial plans omit the field — chart builders must
 *  not break; S1 additive delta). */
export function manipulabilitySeriesOf(
  report: AnalysisReportWire,
): ManipulabilityPointWire[] {
  return report.manipulability_series ?? []
}

// ─── R1/R4/R5 metrics accessors (evaluation hotfix) ────────────────────────
//
// The wire projects `AnalysisMetrics.to_btree_map()` as a flat
// `Record<string, number>` — these typed accessors make the optional keys the
// UI consumes explicit and resilient to absence (old payloads omit them).

/** `min_collision_distance` (metres; negative = collision), or null when the
 *  analysis carried no collision checker. */
export function minClearanceDistance(
  metrics: Record<string, number>,
): number | null {
  const value = metrics['min_collision_distance']
  return typeof value === 'number' ? value : null
}

/** Global waypoint index of the minimum-clearance point, or null when absent.
 *  The wire carries it as a `usize` projected to f64 — rounded on read. */
export function minClearanceWaypoint(
  metrics: Record<string, number>,
): number | null {
  const value = metrics['min_collision_waypoint']
  return typeof value === 'number' ? Math.round(value) : null
}

/** Whether the plan carries detected collisions (`has_collisions` is always
 *  projected by the backend as 1.0/0.0; absent → false). */
export function hasCollisions(metrics: Record<string, number>): boolean {
  return metrics['has_collisions'] === 1
}

/** R5: how much of the plan a problem region spans. The percent derives from
 *  `region.waypoint_count / metrics.waypoint_count` (the wire never ships a
 *  ready-made share); the duration derives from the manipulability series'
 *  `timestamp` (seconds) over the region's waypoint span — both degrade to
 *  null when the wire lacks the data. */
export interface RegionShare {
  percentOfPlan: number | null
  durationSecs: number | null
}

export function regionShareOfPlan(
  region: ProblemRegionWire,
  series: ManipulabilityPointWire[],
  metrics: Record<string, number>,
): RegionShare {
  const total = metrics['waypoint_count']
  const percentOfPlan =
    typeof total === 'number' && total > 0 && region.waypoint_count > 0
      ? (region.waypoint_count / total) * 100
      : null
  const inRange = series.filter(
    (p) =>
      p.waypoint >= region.waypoint_start &&
      p.waypoint <= region.waypoint_end &&
      p.timestamp !== undefined,
  )
  const first = inRange[0]
  const last = inRange[inRange.length - 1]
  const durationSecs =
    inRange.length >= 2 &&
    first?.timestamp !== undefined &&
    last?.timestamp !== undefined
      ? last.timestamp - first.timestamp
      : null
  return { percentOfPlan, durationSecs }
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

/** Stable dedup key for a recommendation row: action kind + edit variant
 *  (hotfix frontend safety net). The backend dedupes by (target segment,
 *  kind); this key mirrors that intent so a leaked duplicate — same failing
 *  segment, same remediation — collapses into a single row. */
export function recommendationKey(recommendation: RecommendationWire): string {
  const variant = Object.keys(recommendation.edit ?? {})[0] ?? ''
  return `${recommendation.action.kind}|${variant}`
}

/** First-wins dedup of recommendation rows by [`recommendationKey`]. Keeps the
 *  original order; distinct kinds / edit variants are never collapsed. */
export function dedupeRecommendations(
  recommendations: RecommendationWire[],
): RecommendationWire[] {
  const seen = new Set<string>()
  const unique: RecommendationWire[] = []
  for (const recommendation of recommendations) {
    const key = recommendationKey(recommendation)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(recommendation)
  }
  return unique
}

/**
 * Problem region a recommendation is tied to, or `null` when the chain cannot
 * be resolved: `recommendation.action.target_observation` → the referenced
 * observation → its `Location::Waypoint` → the region whose interval covers
 * that waypoint. Recommendations that cannot resolve (missing observation,
 * non-waypoint location, waypoint outside every region) are plan-general and
 * are never filtered out by a region selection in the evaluation layout.
 */
export function recommendationRegionId(
  recommendation: RecommendationWire,
  report: AnalysisReportWire,
): number | null {
  const observation = report.observations.find(
    (o) => o.id === recommendation.action.target_observation,
  )
  const waypoint = observation ? waypointOf(observation) : null
  if (waypoint === null) return null
  const region = (report.problem_regions ?? []).find(
    (r) => r.waypoint_start <= waypoint && waypoint <= r.waypoint_end,
  )
  return region ? region.id : null
}
