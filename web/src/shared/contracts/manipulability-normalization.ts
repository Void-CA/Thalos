/**
 * Manipulability normalization — frontend fallback contract (task 4.2, spec
 * analysis-report-contract "Legacy Payload Missing Normalized Fields").
 *
 * New backend payloads carry `normalized_yoshikawa` + `manipulability_grade`
 * per point; the frontend consumes them verbatim. ONLY legacy payloads
 * (grade == None) use these helpers: a local fallback normalized value
 * derived from the raw measure + the scene's L_ref, classified with the SAME
 * constant thresholds the backend uses (calibration-locked — a drift in
 * either side breaks the parity tests).
 */

/** Low threshold — mirrors backend `T_LOW` (re-calibrated under the
 *  moving-only `manipulability_reference_dimension`, task 6.1 remediation;
 *  provenance documented in thalos-core/kinematics/jacobian/manipulability.rs
 *  — SCARA canonical, L_ref 1.8, exact point-to-point partition). */
export const T_LOW = 0.0926

/** High threshold — mirrors backend `T_HIGH` (same calibration origin). */
export const T_HIGH = 0.15433

/** Categorical manipulability grade over a dimensionless normalized value. */
export type ManipulabilityGradeWire = 'low' | 'medium' | 'high'

/**
 * Classify a dimensionless normalized value against constant thresholds.
 * Same partition as the backend `classify(n, T_LOW, T_HIGH)`:
 * `low < t_low ≤ medium < t_high ≤ high` (boundaries inclusive upward).
 * Defaults to the calibrated constants when thresholds are not passed.
 */
export function classifyGrade(
  normalized: number,
  tLow: number = T_LOW,
  tHigh: number = T_HIGH,
): ManipulabilityGradeWire {
  if (normalized < tLow) return 'low'
  if (normalized < tHigh) return 'medium'
  return 'high'
}

/** Floor mirroring the backend `l_ref > ε` guardrail (no NaN/Inf). */
const L_REF_EPS = 1e-9

/**
 * Fallback normalized measure for LEGACY payloads: `raw / L_ref³`.
 *
 * For a revolute-only robot with ≥ 3 DOF this is the EXACT pre-SVD
 * normalized value (each linear Jacobian column — and therefore each
 * singular value — scales by `1/L_ref`, so `∏σ′ᵢ = raw / L_ref³`). For
 * mixed revolute+prismatic robots it is a documented approximation (the
 * prismatic column is dimensionless and does NOT scale; only the backend
 * re-SVD is exact). Used ONLY when the backend shipped no normalized value.
 *
 * Guardrail: a degenerate/absent L_ref (≤ ε) degrades to `raw` — never
 * NaN/Inf from a broken value.
 */
export function computeFallbackNormalized(rawYoshikawa: number, lRef: number): number {
  if (lRef <= L_REF_EPS) return rawYoshikawa
  return rawYoshikawa / lRef ** 3
}
