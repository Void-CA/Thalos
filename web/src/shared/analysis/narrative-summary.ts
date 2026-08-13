import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'
import { evidenceDirection, evidenceReading, humanizeKey } from './evidence'

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
 * (risk, evidence, region explanation). It never consumes the concrete
 * `RecommendationWire`; `recommendation_context` derives from
 * `assessment.recommendations` presence. No factor absent from the input
 * evidence is ever asserted (traceability). Rules are NOT narrative — the
 * "N rules triggered: R08, R09…" sentence is gone; triggered rules belong to
 * the TriggeredRules component.
 *
 * UX redesign (binding brief): the summary reads like a human verdict in
 * plain English — no raw rule ids, no raw evidence keys, human factor labels
 * derived from the evidence value + risk direction (see `evidence.ts`).
 */

export interface NarrativeFactor {
  /** Evidence key — MUST exist in `AssessmentWire.evidence` (traceability). */
  key: string
  /** Human-readable chip label, e.g. "Low manipulability". */
  label: string
}

export interface NarrativeSummary {
  headline: string
  summary: string
  primary_factors: NarrativeFactor[]
  recommendation_context: string | null
}

/** Verbatim risk-tier headlines — the categorical verdict, no invented claims. */
const RISK_HEADLINES: Record<AssessmentWire['risk'], string> = {
  low: 'Low risk plan',
  medium: 'Medium risk plan',
  high: 'High risk plan',
  critical: 'Critical risk plan',
}

/** Human lead sentence per risk tier (the headline's plain-English restatement). */
const RISK_LEAD: Record<AssessmentWire['risk'], string> = {
  low: 'The plan is low risk',
  medium: 'The plan is moderately risky',
  high: 'The plan is highly risky',
  critical: 'The plan is critically risky',
}

/** 0..1 risk contribution of one evidence entry (0 = best, 1 = worst). */
function problemScore(key: string, value: number): number {
  const direction = evidenceDirection(key)
  if (direction === 0) return 0
  const raw = direction < 0 ? 1 - value : value
  return Math.min(Math.max(raw, 0), 1)
}

interface RankedFactor extends NarrativeFactor {
  score: number
  /** Human summary phrase ("manipulability is moderate") or null when the
   *  key is unknown to the semantics table. */
  phrase: string | null
}

/** The most problematic evidence variables PRESENT in the input, ranked by
 *  risk contribution (top 3, stable order). Only keys actually carried by the
 *  wire AND with a known risk direction are ever included — traceability
 *  invariant; unknown keys cannot be ranked (direction unknown). */
function primaryFactorsOf(evidence: Record<string, number>): RankedFactor[] {
  return Object.entries(evidence)
    .map(([key, value]) => {
      const reading = evidenceReading(key, value)
      return {
        key,
        label: reading ? reading.chipLabel : humanizeKey(key),
        phrase: reading ? reading.phrase : null,
        score: problemScore(key, value),
      }
    })
    .filter((factor) => evidenceDirection(factor.key) !== 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

/** "a", "a and b", "a, b, and c" — the Oxford-comma join for human sentences. */
function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
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

  const ranked = primaryFactorsOf(assessment.evidence)
  const primary_factors: NarrativeFactor[] = ranked.map(({ key, label }) => ({ key, label }))

  const sentences: string[] = []

  // Lead sentence: risk + the human readings of the top factors.
  const phrases = ranked.map((factor) => factor.phrase).filter((p): p is string => p !== null)
  sentences.push(phrases.length > 0 ? `${RISK_LEAD[assessment.risk]}: ${joinWithAnd(phrases)}.` : `${RISK_LEAD[assessment.risk]}.`)

  // Region sentences — human span, at most two (keeps the summary in the
  // 2-4 sentence budget; the full region list lives elsewhere in the tab).
  for (const region of regions.slice(0, 2)) {
    const span =
      region.waypoint_end > region.waypoint_start
        ? `waypoints ${region.waypoint_start}\u2013${region.waypoint_end}`
        : `waypoint ${region.waypoint_start}`
    const cause = region.explanation?.cause
    sentences.push(
      cause
        ? `A ${region.severity} ${region.kind} region was detected across ${span}: ${cause}.`
        : `A ${region.severity} ${region.kind} region was detected across ${span}.`,
    )
  }
  if (regions.length > 2) {
    const extra = regions.length - 2
    sentences.push(`${extra} more problem ${extra === 1 ? 'region was' : 'regions were'} also detected.`)
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

export interface WhySummary {
  /** Short hero line — the elevation story: "Singular event detected →
   *  risk elevated to High". */
  line: string
  /** Explanation block: the mechanism that produced the verdict. */
  detail: string
}

/**
 * The "why" of the verdict when a LOCALIZED singular event is present
 * (`evidence.singularity_proximity >= 0.5` — the analyzer detected a real
 * singular event). This is the elevation story the defense must tell: the
 * verdict did not appear magically. Null when no singular event is present.
 */
export function buildWhy(assessment: AssessmentWire): WhySummary | null {
  const singularScore = assessment.evidence['singularity_proximity']
  if (singularScore === undefined || singularScore < 0.5) return null
  const riskWord = assessment.risk.charAt(0).toUpperCase() + assessment.risk.slice(1)
  const singularRule = assessment.trace.find((t) => t.rule_id === 'R09_near_singularity')
  return {
    line: `Singular event detected → risk elevated to ${riskWord}`,
    detail: singularRule
      ? `A singular event was detected in the trajectory. ${singularRule.rule_id} classified the evidence as ${assessment.risk} risk.`
      : `A singular event was detected in the trajectory, elevating the risk to ${assessment.risk}.`,
  }
}
