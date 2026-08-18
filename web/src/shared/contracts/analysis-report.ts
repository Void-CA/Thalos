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
  /** Dimensionless normalized Yoshikawa measure ∏σ′ᵢ (pre-SVD scaled
   *  Jacobian, spec analysis-report-contract "Additive Normalized
   *  Manipulability on Wire"). ADDITIVE — ABSENT on legacy payloads; the
   *  frontend then computes its local fallback from `yoshikawa` + `L_ref`.
   *  Absence is the signal — never a fabricated value. */
  normalized_yoshikawa?: number
  /** Backend-classified manipulability grade: "low" | "medium" | "high"
   *  (constant dimensionless thresholds T_LOW/T_HIGH, identical for every
   *  robot). ADDITIVE — `undefined` on legacy payloads triggers the
   *  frontend fallback classification. */
  manipulability_grade?: 'low' | 'medium' | 'high'
  /** Percentile-based score (0–1) of this waypoint relative to the robot's
   *  OWN normalized-yoshikawa distribution — staged against P05–P95 over
   *  the analyzed set (design "relative_manipulability"). ADDITIVE — ABSENT
   *  until the backend computes it; absence is the signal, consumers must
   *  never fabricate a value (I2: the UI does not recompute manipulability). */
  relative_manipulability?: number
}

/** One singularity point per analyzed waypoint (dense series). Projection of
 *  `PlanAnalysis.waypoints[].singularity` computed by the backend. Unlike
 *  `observations` (which only emit anomalies), this series is DENSE — it covers
 *  the whole trajectory, so the viewport can color every waypoint. The
 *  `singularity_state` is the backend's runtime classification projected onto
 *  the wire (`"normal" | "near" | "singular"`, same logic that fires the
 *  Singularity/NearSingularity observations). */
export interface SingularityPointWire {
  /** 0-based waypoint index in the analyzed plan. */
  waypoint: number
  /** Trajectory time of the waypoint in seconds (additive — optional for
   *  backward compatibility: older backends omit it, consumers fall back to
   *  the waypoint index on the x axis). */
  timestamp?: number
  /** Jacobian determinant det(J·Jᵀ) at that waypoint. */
  det_jtj?: number
  /** Condition number κ(J) at that waypoint. */
  condition_number?: number
  /** Backend classification: "normal" | "near" | "singular". */
  singularity_state: 'normal' | 'near' | 'singular'
}

/** A remediation recommendation (spec recommendation-model "Wire Contract").
 *  Projection of `Recommendation { id, action, edit, status, reason }` — the
 *  typed `edit` is a semantic plan command (design D1) that the
 *  Preview/Apply/Undo pipeline executes. The frontend treats `edit` as opaque
 *  in PR3 (Preview only) — Apply/Undo (PR4/PR5) consume it verbatim from the
 *  wire. */
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
  /** Structured reason when `status` is "unavailable" (design ADR-2, additive
   *  — absent for available/undetermined recommendations, so old payloads
   *  deserialize unchanged). */
  reason?:
    | 'ik_failed'
    | 'compile_failed'
    | 'planning_failed'
    | 'unreachable_configuration'
    | 'not_applicable'
    | 'unsupported'
}

/** One fired rule summarized on the wire (intelligent assessment). */
export interface TriggeredRuleWire {
  /** Rule id, e.g. "R07_low_manipulability". */
  id: string
  /** Reasoning category ("collision" | "singularity" | "manipulability" |
   *  "trajectory"). */
  category: string
  /** Agenda priority. */
  priority: number
}

/** A reference to an existing PlanAdvisor action the diagnosis associates with. */
export interface AssessmentRecommendationWire {
  /** The associated action kind (e.g. "Manipulability"). */
  action_kind: string
  /** Problem region the recommendation addresses, when resolvable. */
  region_id?: number
  /** Human-readable rationale (English). */
  rationale: string
}

/** One inference trace entry — a fired rule in exact firing order. */
export interface AssessmentTraceEntryWire {
  /** Fired rule id. */
  rule_id: string
  /** Agenda priority. */
  priority: number
  /** Antecedent → matched value. */
  bindings: Record<string, string>
  /** Derived facts produced by this firing. */
  derived_output: Record<string, boolean>
}

/** The intelligent assessment verdict (thalos-intelligence), projected by the
 *  backend DTO (spec analysis-report-contract "Assessment DTO Structure").
 *  Mirrors the domain `Assessment` field-for-field. */
export interface AssessmentWire {
  /** Categorical verdict, lowercase on the wire. */
  risk: 'low' | 'medium' | 'high' | 'critical'
  /** Quality score in [0, 1] (normalized complement of the crisp risk). */
  quality: number
  /** Rules that fired during inference. */
  triggered_rules: TriggeredRuleWire[]
  /** Key-value evidence (derived inputs + rule evidence). */
  evidence: Record<string, number>
  /** References to existing PlanAdvisor actions by kind. */
  recommendations: AssessmentRecommendationWire[]
  /** Inference trace in firing order. */
  trace: AssessmentTraceEntryWire[]
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
  /** Dense per-waypoint singularity series. OPTIONAL on the wire: the backend
   *  annotates it `#[serde(default, skip_serializing_if = "Vec::is_empty")]`,
   *  so old payloads and trivial plans omit it (I3 — additive delta). Unlike
   *  `observations` this is DENSE (one entry per analyzed waypoint), which lets
   *  trajectory coloring cover the whole plan. */
  singularity_series?: SingularityPointWire[]
  /** Remediation recommendations (PR2). OPTIONAL on the wire (additive, I3):
   *  old payloads omit the field; the advisor only produces recommendations
   *  when the analysis flow carries program + solver context. */
  recommendations?: RecommendationWire[]
  /** Intelligent assessment verdict (additive, I3). OPTIONAL on the wire:
   *  old payloads omit the field; the Evaluation workspace hides the
   *  "Intelligent Assessment" section when it is absent. */
  assessment?: AssessmentWire
  /** Candidate alternatives ranking (additive, spec candidate-alternatives-demo).
   *  OPTIONAL on the wire (`#[serde(default)]` on the Rust DTO): old payloads
   *  omit the field and the Candidate Alternatives section stays hidden. */
  candidate_ranking?: CandidateRankingWire
}

// ─── candidate_ranking (additive, spec candidate-alternatives-demo) ─────────
// The web contract mirrors the Rust `CandidateRankingDto` family field-for-field
// (backend/crates/thalos-api/src/features/plan_analysis/dto.rs). The strategy
// kind travels as a closed string union (`"Direct" | "InsertWaypoint" |
// "AlternateElbow"`) and the reason keeps its STRUCTURAL shape — component ids
// + numeric values, never narrative text. Display-only: the UI never re-derives
// risk, quality, cost or selection from these numbers.

/** `"Direct" | "InsertWaypoint" | "AlternateElbow"` — the closed strategy set
 *  (`StrategyKind` on the backend). */
export type MotionStrategyWire = 'Direct' | 'InsertWaypoint' | 'AlternateElbow'

/** The fixed metric components of the comparison — `"risk" | "duration" |
 *  "manipulability" | "length" | "cost"` (the evaluator's objective axes). */
export type MetricComponentWire = 'risk' | 'duration' | 'manipulability' | 'length' | 'cost'

/** Projection of `CandidateRankingDto`: the admissible candidates ordered by
 *  ascending objective cost J, the selection, the DERIVED reason and the full
 *  strategy trace (which strategies generated a candidate and which skipped,
 *  with the structural reason — ADR-3 observability). */
export interface CandidateRankingWire {
  /** Admissible candidates ordered by ascending cost J (argmin J wins). */
  ranked: RankedCandidateWire[]
  /** Strategy of the selected candidate (argmin J); absent when no candidate
   *  was admissible. Always one of the closed `MotionStrategyWire` values. */
  selected?: MotionStrategyWire
  /** Reason derived from the metric comparison vs the Direct baseline —
   *  structure, never hand-written narrative. */
  reason: SelectionReasonWire
  /** Full strategy trace: every strategy applied with its outcome
   *  (`generated`/`skipped` + reason). Additive — absent rows default to [].
   */
  strategy_trace: StrategyTraceWire[]
}

/** One ranking row: strategy + RAW metrics + the objective cost J. The raw
 *  risk is the crisp `1 − quality` of the frozen Assessor — verbatim. */
export interface RankedCandidateWire {
  /** `"Direct" | "InsertWaypoint" | "AlternateElbow"`. */
  strategy: MotionStrategyWire
  /** RAW risk — the crisp `1 − quality` of the Assessor (verbatim). */
  risk: number
  /** RAW duration in seconds — verbatim from the analyzed trajectory. */
  duration: number
  /** RAW average manipulability — verbatim. */
  manipulability: number
  /** RAW path length in metres — verbatim. */
  length: number
  /** The objective cost `J = Σ w_i · norm_i` (RELATIVE to the candidate set). */
  cost: number
}

/** The selection reason — DERIVED from metric differences vs the Direct
 *  baseline; never handwritten text. Discriminated on `kind`:
 *  `"selected"` carries the metric comparison (+ optional fixed endpoints/task
 *  invariants, faithful to the Rust `Option<String>`); `"no_admissible_candidate"`
 *  carries only the structural reason. */
export type SelectionReasonWire =
  | {
      kind: 'selected'
      /** The selected strategy. */
      strategy: MotionStrategyWire
      /** Metric differences vs the Direct baseline (fixed components). */
      metric_comparison: MetricComparisonWire[]
      /** Fixed: `"Endpoints: preserved"` — every admissible candidate passed
       *  the endpoint invariant ε of the gate. OPTIONAL (Rust `Option<String>`). */
      endpoints?: string
      /** Fixed: `"Task: preserved"` — every admissible candidate passed the
       *  task-identity invariant of the gate. OPTIONAL (Rust `Option<String>`). */
      task?: string
    }
  | {
      kind: 'no_admissible_candidate'
      /** Structural reason for the absence of selection. */
      reason: string
    }

/** One row of the metric comparison: fixed component + selected vs baseline
 *  values. The direction (`<` / `>`) is derivable from the values — the wire
 *  never carries a sign. */
export interface MetricComparisonWire {
  /** `"risk" | "duration" | "manipulability" | "length" | "cost"`. */
  component: MetricComponentWire
  /** Value of the selected candidate. */
  selected_value: number
  /** Value of the Direct baseline. */
  baseline_value: number
}

/** One strategy-trace row: the strategy applied + its outcome. The trace is
 *  COMPLETE — it includes the strategies that produced no candidate, with
 *  their structural reason (ADR-3 observability). */
export interface StrategyTraceWire {
  /** `"Direct" | "InsertWaypoint" | "AlternateElbow"`. */
  strategy: MotionStrategyWire
  /** Outcome: `generated` or `skipped` (with the structural reason). */
  outcome: StrategyOutcomeWire
}

/** Outcome of a strategy in the trace — `generated` or `skipped` with the
 *  structural reason. A UI renders `Direct → Generated` / `InsertWaypoint →
 *  Skipped — UnsupportedSegment` without inventing anything. */
export interface StrategyOutcomeWire {
  /** `"generated" | "skipped"`. */
  kind: 'generated' | 'skipped'
  /** Structural reason of the skip (only when `kind === "skipped"`). */
  reason?: NoCandidateReasonWire
}

/** Structural reason for not generating a candidate (design ADR-3):
 *  `IkFailed` | `UnsupportedSegment` | `InvariantViolation { invariant }`.
 *  Mirrors the Rust enum externally-tagged: `{"InvariantViolation":
 *  {"invariant": "segment_out_of_range"}}`. */
export type NoCandidateReasonWire =
  | 'IkFailed'
  | 'UnsupportedSegment'
  | { InvariantViolation: { invariant: string } }

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

/** The per-waypoint singularity series, defaulting to `[]` when absent
 *  (I3: old payloads and trivial plans omit the field — dense coloring must not
 *  break on old payloads that only have observations). */
export function singularitySeriesOf(
  report: AnalysisReportWire,
): SingularityPointWire[] {
  return report.singularity_series ?? []
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

/**
 * Build the per-waypoint analysis view from DENSE series, overlaying the
 * authoritative sparse `observations`.
 *
 * Why DENSE: `observations` only emit anomalies, so a healthy/average plan has
 * almost no waypoints colored (everything fell back to grey `nodata`). The
 * backend already computes a per-waypoint `manipulability_series` and
 * `singularity_series` (one entry per analyzed waypoint); this view consumes
 * them so trajectory coloring covers the WHOLE plan.
 *
 * - `manipulability` ← `manipulability_series.waypoints[].yoshikawa`
 * - `singularity_state` ← `singularity_series.waypoints[].singularity_state`
 * - `severity` is DERIVED from the dense signals for COLORING ONLY (a
 *   visualization-level warning/critical indicator), never the Assessor's
 *   rule-engine verdict. Any observation's own severity OVERRIDES it on that
 *   waypoint (authoritative when present).
 * - `clearance` stays observation-derived (`min_collision_distance` is not
 *   part of a series).
 *
 * Old payloads with neither series nor observations still return `[]`.
 */
export function waypointAnalysisFromReport(report: AnalysisReportWire): WaypointAnalysisView[] {
  const entries: WaypointAnalysisView[] = []
  const seen = new Set<number>()

  // Dense pass: seed every series-covered waypoint.
  for (const p of manipulabilitySeriesOf(report)) {
    seen.add(p.waypoint)
    entries.push({
      index: p.waypoint,
      severity: deriveSeverity(p.yoshikawa, null),
      manipulability: p.yoshikawa,
      singularity_state: null,
      clearance: null,
    })
  }
  for (const s of singularitySeriesOf(report)) {
    const existing = entries.find(e => e.index === s.waypoint)
    if (existing) {
      existing.singularity_state = s.singularity_state
      existing.severity = derivedSeverityOf(existing)
    } else {
      seen.add(s.waypoint)
      entries.push({
        index: s.waypoint,
        severity: deriveSeverity(null, s.singularity_state),
        manipulability: null,
        singularity_state: s.singularity_state,
        clearance: null,
      })
    }
  }

  // Observation pass: authoritative override for anomaly waypoints.
  for (const observation of report.observations) {
    const waypoint = waypointOf(observation)
    if (waypoint === null) continue
    const entry = entries.find(e => e.index === waypoint)
    const severity: WaypointAnalysisView['severity'] =
      observation.severity === 'Error'
        ? 'critical'
        : observation.severity === 'Warning'
          ? 'warning'
          : 'good'
    if (entry) {
      entry.severity = severity
      if (observation.kind === 'LowManipulability') {
        entry.manipulability = numericAttribute(observation.attributes, 'value')
      } else if (observation.kind === 'Singularity') {
        entry.singularity_state = 'singular'
      } else if (observation.kind === 'NearSingularity') {
        entry.singularity_state = 'near'
      }
      if (observation.kind === 'CollisionRisk' || observation.kind === 'CollisionNear') {
        entry.clearance = numericAttribute(observation.attributes, 'value')
      }
    } else {
      seen.add(waypoint)
      entries.push({
        index: waypoint,
        severity,
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
  }

  void seen
  return entries.sort((a, b) => a.index - b.index)
}

/** Visualization-level severity from dense signals (see the dense doc above).
 *  `singular` is critical; low manipulability drops to warning (harder floor
 *  → critical); otherwise good. An observation's severity overrides this. */
function deriveSeverity(
  yoshikawa: number | null,
  singularity_state: WaypointAnalysisView['singularity_state'],
): WaypointAnalysisView['severity'] {
  if (singularity_state === 'singular') return 'critical'
  if (singularity_state === 'near') return 'warning'
  if (yoshikawa != null) {
    if (yoshikawa < 0.1) return 'critical'
    if (yoshikawa < 0.3) return 'warning'
  }
  return 'good'
}

/** Recompute severity for a partially-populated entry after a dense signal was
 *  attached (merged manipulability + singularity). */
function derivedSeverityOf(entry: { manipulability: number | null; singularity_state: WaypointAnalysisView['singularity_state'] }): WaypointAnalysisView['severity'] {
  return deriveSeverity(entry.manipulability, entry.singularity_state)
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
