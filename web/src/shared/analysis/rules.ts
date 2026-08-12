/**
 * Rule semantics — the human labels for the thalos-intelligence KB rules
 * (backend `crates/thalos-intelligence/src/kb.rs`, frozen 12-rule base).
 * Pure: rule id in, human label / tone out; unknown ids fall back to a
 * humanized version of the id so the UI never shows a raw moniker.
 *
 * Labels mirror the KB semantics rule-by-rule (a rule's antecedents/consequents
 * decide whether it reads as a problem or as a safe/positive fact).
 */

import { humanizeKey, variableLabel } from './evidence'

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

// ─── Rule reasoning (trace → human phrases) ─────────────────────────────────

/** Fuzzy set names the KB matches metrics against ("low"/"high"/"medium"/
 *  "near"/"danger"/"safe"). A bare variable key whose VALUE is one of these is
 *  the `{variable: set}` binding shape — handled defensively; the wire today
 *  embeds both in a single key ("Manipulability IS low"). */
const KNOWN_SETS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'near', 'danger', 'safe'])

/** Categorical risk keys — a RiskIs consequent, handled defensively (the engine
 *  routes RiskIs into the output risk, never into derived_output). */
const RISK_KEYS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'critical'])

/** derived_output key → noun phrase for a "marked …" reading. Keys beyond the
 *  KB facts ("danger_zone", "safe_clearance", "near_singularity",
 *  "good_manipulability") fall back to the humanized key, so a "marked" reading
 *  is never invented for an unknown key. */
const DERIVED_LABELS: Record<string, string> = {
  danger_zone: 'danger zone',
  safe_clearance: 'safe clearance',
  near_singularity: 'near singularity',
  good_manipulability: 'good manipulability',
  complexity_high: 'high complexity',
  manipulability_low: 'low manipulability',
  collision_danger: 'collision danger',
  singularity_high: 'high singularity proximity',
}

/** One antecedent → human phrase. Handles the real wire shape (set embedded in
 *  the key, membership degree as the value: "Manipulability IS low" → "0.667")
 *  AND the `{variable: set}` shape, plus fact bindings ("danger_zone" → "true").
 */
function bindingEntryPhrase(key: string, value: string): string {
  const metric = /^(.+?)\s+IS\s+(\w+)$/i.exec(key)
  if (metric) {
    return `${variableLabel(metric[1])} is ${metric[2].toLowerCase()}`
  }
  if (KNOWN_SETS.has(value)) {
    return `${variableLabel(key)} is ${value}`
  }
  if (value === 'true' || value === 'false') {
    return `${humanizeKey(key).toLowerCase()} is ${value}`
  }
  return `${humanizeKey(key)} = ${value}`
}

/** Human "why": the rule's matched antecedents as readable phrases, e.g.
 *  `{"Manipulability IS low": "0.667"}` → "Manipulability is low". Multiple
 *  bindings are joined with "; ". Empty → "—". */
export function bindingPhrase(bindings: Record<string, string>): string {
  const phrases = Object.entries(bindings).map(([key, value]) => bindingEntryPhrase(key, value))
  return phrases.length > 0 ? phrases.join('; ') : '—'
}

/** One trace binding rendered in the "why" cell: the human phrase plus the
 *  numeric membership degree when it is one (the real wire shape
 *  `{"Manipulability IS low": "0.667"}`). Fact / set-name bindings carry no
 *  degree — their phrase already shows the value. */
export interface BindingEntry {
  phrase: string
  degree: string | null
}

/** Human "why" entries, one per antecedent binding — each with its phrase and,
 *  for a metric membership degree, the raw numeric value (rendered beside the
 *  phrase as "· 0.667"). Empty bindings → `[]`. */
export function bindingEntries(bindings: Record<string, string>): BindingEntry[] {
  return Object.entries(bindings).map(([key, value]) => ({
    phrase: bindingEntryPhrase(key, value),
    degree: /^.+?\s+IS\s+\w+$/i.test(key) ? value.trim() : null,
  }))
}

/** Human "what": the rule's derived output read as produced consequences, e.g.
 *  `{danger_zone: true}` → "marked danger zone". Risk-set keys read as
 *  "raised risk to …". Empty → "—". */
export function consequentPhrase(derived: Record<string, boolean>): string {
  const phrases = Object.entries(derived).map(([key, value]) => {
    if (value && RISK_KEYS.has(key)) return `raised risk to ${key}`
    const noun = DERIVED_LABELS[key] ?? humanizeKey(key).toLowerCase()
    return value ? `marked ${noun}` : `cleared ${noun}`
  })
  return phrases.length > 0 ? phrases.join(', ') : '—'
}
