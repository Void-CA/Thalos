import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'
import { verdictFromQuality } from './verdict'

/**
 * intelligible-repair-loop — narrative summary builder (task 1.2).
 *
 * A derived VIEW MODEL (NOT a wire contract): `buildNarrativeSummary` renders
 * the `AssessmentWire` verdict + the `ProblemRegionWire[]` list into an
 * English narrative for the Intelligence tab. `AssessmentWire` stays the input
 * contract; the `NarrativeSummary` types live locally in this module.
 *
 * Grounding contract (user-review invariant, tasks.md 1.2): every sentence is
 * backed by a wire field — the narrative explains Assessment + regions ONLY
 * (risk, quality, triggered_rules, evidence, region explanation). It never
 * consumes the concrete `RecommendationWire`; `recommendation_context` derives
 * from `assessment.recommendations` presence. No factor absent from the input
 * evidence is ever asserted (traceability). Precedent: `severityOf` /
 * `categoryLabel` pure helpers on the contracts.
 */

export interface NarrativeFactor {
  /** Evidence key — MUST exist in `AssessmentWire.evidence` (traceability). */
  key: string
  /** Human-readable chip label. */
  label: string
}

export interface NarrativeSummary {
  headline: string
  summary: string
  primary_factors: NarrativeFactor[]
  recommendation_context: string | null
}

/** Human labels for the canonical fuzzy evidence variables (thalos-intelligence
 *  `kb.rs` linguistic variables). Unknown keys keep their humanized key as
 *  label — labels are cosmetic, the key is the traceability anchor. */
const EVIDENCE_LABELS: Record<string, string> = {
  manipulability: 'Manipulability',
  singularity_proximity: 'Singularity proximity',
  collision_clearance: 'Collision clearance',
  trajectory_complexity: 'Trajectory complexity',
}

/** Verbatim risk-tier headlines — the categorical verdict, no invented claims. */
const RISK_HEADLINES: Record<AssessmentWire['risk'], string> = {
  low: 'Low risk plan',
  medium: 'Medium risk plan',
  high: 'High risk plan',
  critical: 'Critical risk plan',
}

/** Risk contribution direction per canonical variable: -1 means lower is worse
 *  (manipulability, clearance), +1 means higher is worse (proximity,
 *  complexity) — the fuzzy KB semantics. Keys outside this table are excluded
 *  from `primary_factors` (direction unknown → cannot be ranked). */
const RISK_DIRECTION: Record<string, number> = {
  manipulability: -1,
  collision_clearance: -1,
  singularity_proximity: 1,
  trajectory_complexity: 1,
}

/** 0..1 risk contribution of one evidence entry (0 = best, 1 = worst). */
function problemScore(key: string, value: number): number {
  const direction = RISK_DIRECTION[key] ?? 0
  const raw = direction < 0 ? 1 - value : value
  return Math.min(Math.max(raw, 0), 1)
}

/** snake_case wire key → display label fallback (cosmetic only). */
function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The most problematic evidence variables PRESENT in the input, ranked by
 *  risk contribution (top 3, stable order). Only keys actually carried by the
 *  wire AND with a known risk direction are ever included — traceability
 *  invariant; unknown keys cannot be ranked (direction unknown). */
function primaryFactorsOf(evidence: Record<string, number>): NarrativeFactor[] {
  return Object.entries(evidence)
    .filter(([key]) => RISK_DIRECTION[key] !== undefined)
    .map(([key, value]) => ({ key, score: problemScore(key, value) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ key }) => ({ key, label: EVIDENCE_LABELS[key] ?? humanizeKey(key) }))
}

/**
 * Build the intelligible narrative for an assessment + its problem regions.
 * Pure and synchronous: same input → same narrative.
 */
export function buildNarrativeSummary(
  assessment: AssessmentWire,
  regions: ProblemRegionWire[],
): NarrativeSummary {
  const headline = RISK_HEADLINES[assessment.risk]

  // Canonical verdict language: the primary number is the score (0–100 derived
  // from the wire quality), never the raw 0..1 quality.
  const { score, grade } = verdictFromQuality(assessment.quality)

  const sentences: string[] = [
    `The plan is assessed at ${assessment.risk} risk with a score of ${score} (${grade}).`,
  ]

  if (assessment.triggered_rules.length > 0) {
    const ids = assessment.triggered_rules.map((rule) => rule.id)
    sentences.push(
      `${ids.length} rule${ids.length === 1 ? '' : 's'} triggered: ${ids.join(', ')}.`,
    )
  }

  const primary_factors = primaryFactorsOf(assessment.evidence)
  if (primary_factors.length > 0) {
    const parts = primary_factors.map(
      (factor) => `${factor.key} ${assessment.evidence[factor.key].toFixed(3)}`,
    )
    sentences.push(`Key evidence: ${parts.join(', ')}.`)
  }

  for (const region of regions) {
    const span =
      region.waypoint_end > region.waypoint_start
        ? `wp${region.waypoint_start}\u2013wp${region.waypoint_end}`
        : `wp${region.waypoint_start}`
    const cause = region.explanation?.cause
    sentences.push(
      cause
        ? `A ${region.severity} ${region.kind} region spans ${span}: ${cause}.`
        : `A ${region.severity} ${region.kind} region spans ${span}.`,
    )
  }

  const recommendation_context =
    assessment.recommendations.length > 0
      ? `The assessment suggests ${assessment.recommendations.length} repair ${assessment.recommendations.length === 1 ? 'recommendation' : 'recommendations'}.`
      : null

  return {
    headline,
    summary: sentences.join(' '),
    primary_factors,
    recommendation_context,
  }
}
