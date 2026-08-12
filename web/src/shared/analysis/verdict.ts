/**
 * Canonical verdict view model (score + grade) — the ONE verdict language the
 * /evaluation UI presents. Precedent: `narrative-summary.ts` (a pure derived
 * view model, NOT a wire contract).
 *
 * The UI's primary verdict is `score` (0–100) + `grade` (Excellent/Good/Fair/
 * Poor); `risk` is a secondary dimension (safety/criticality). Everything else
 * (quality 0..1, health %) stops being presented as an independent verdict.
 *
 * Alignment with the backend (do NOT invent a divergent band):
 *  - `grade_for(quality_index)` (thalos-core `analysis/scoring.rs`):
 *    ≥ 0.9 Excellent, ≥ 0.7 Good, ≥ 0.5 Fair, strictly below → Poor (inclusive
 *    lower bounds).
 *  - `score = round(quality_index × 100)` (thalos-api `dto.rs` SummaryDto).
 * In score space (0–100) those thresholds are therefore ≥ 90 / ≥ 70 / ≥ 50.
 * The only theoretical divergence is a rounding boundary (quality_index 0.895
 * → score 90, backend grades it Good); the integer score cannot express it,
 * and it is a UI-invisible edge.
 */
export type VerdictGrade = 'Excellent' | 'Good' | 'Fair' | 'Poor'

/** Score-space grade boundaries, mirroring the backend `grade_for` mapping. */
export const GRADE_THRESHOLDS = {
  excellent: 90,
  good: 70,
  fair: 50,
} as const

/** Canonical grade from a 0–100 score (backend-aligned: ≥90/≥70/≥50). */
export function gradeFromScore(score: number): VerdictGrade {
  if (score >= GRADE_THRESHOLDS.excellent) return 'Excellent'
  if (score >= GRADE_THRESHOLDS.good) return 'Good'
  if (score >= GRADE_THRESHOLDS.fair) return 'Fair'
  return 'Poor'
}

/** 0–100 score derived from a 0..1 quality value — same projection as the
 *  backend DTO (`round(quality × 100)`, clamped to 100). */
export function scoreFromQuality(quality: number): number {
  return Math.min(100, Math.max(0, Math.round(quality * 100)))
}

/** The canonical verdict pair derived from a 0..1 quality value (the wire
 *  assessment carries `quality`, never a ready-made score). */
export interface Verdict {
  score: number
  grade: VerdictGrade
}

export function verdictFromQuality(quality: number): Verdict {
  const score = scoreFromQuality(quality)
  return { score, grade: gradeFromScore(score) }
}
