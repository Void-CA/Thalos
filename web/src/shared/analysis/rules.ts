/**
 * Rule semantics — the human labels for the thalos-intelligence KB rules
 * (backend `crates/thalos-intelligence/src/kb.rs`, frozen 12-rule base).
 * Pure: rule id in, human label / tone out; unknown ids fall back to a
 * humanized version of the id so the UI never shows a raw moniker.
 *
 * Labels mirror the KB semantics rule-by-rule (a rule's antecedents/consequents
 * decide whether it reads as a problem or as a safe/positive fact).
 */

import { humanizeKey } from './evidence'

/** Rule id → human label (one per KB rule). */
export const RULE_LABELS: Record<string, string> = {
  R01_collision_danger: 'Collision danger',
  R02_collision_near: 'Near collision',
  R03_collision_danger_evidence: 'Collision danger confirmed',
  R04_singularity_medium: 'Moderate singularity proximity',
  R05_manipulability_medium: 'Moderate manipulability',
  R06_high_complexity: 'High trajectory complexity',
  R07_low_manipulability: 'Low manipulability',
  R08_safe_clearance: 'Safe clearance',
  R09_near_singularity: 'Near singularity',
  R10_manipulability_high: 'High manipulability',
  R11_danger_zone: 'Danger zone',
  R12_safe_plan: 'Safe plan',
}

/** Rules that read as safe/positive — presented with a neutral/success tone,
 *  never as warnings. Determined per-rule (the label map), not by category. */
export const POSITIVE_RULES: ReadonlySet<string> = new Set([
  'R08_safe_clearance',
  'R10_manipulability_high',
  'R12_safe_plan',
])

/** Wire reasoning category → display label. */
export const CATEGORY_LABELS: Record<string, string> = {
  collision: 'Collision',
  singularity: 'Singularity',
  manipulability: 'Manipulability',
  trajectory: 'Trajectory',
}

/** Display order for the rule groups (unknown categories append after). */
export const CATEGORY_ORDER: readonly string[] = [
  'collision',
  'singularity',
  'manipulability',
  'trajectory',
]

/** Human label for a rule id (fallback: humanized id). */
export function ruleLabel(id: string): string {
  return RULE_LABELS[id] ?? humanizeKey(id)
}

/** Whether the rule id reads as a safe/positive fact (not a warning). */
export function isPositiveRule(id: string): boolean {
  return POSITIVE_RULES.has(id)
}
