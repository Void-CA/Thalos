/**
 * Evidence semantics — the shared human reading of the fuzzy evidence
 * variables (intelligence UX redesign). Pure: one key + value in, one
 * reading out; unknown keys yield `null` so consumers never invent a reading.
 *
 * Thresholds are pinned to the thalos-intelligence KB (backend
 * `crates/thalos-intelligence/src/kb.rs`), NOT re-derived:
 *  - manipulability < 0.3 → low (MANIPULABILITY_LOW_THRESHOLD);
 *  - singularity_proximity: (near + singular) / waypoints, 0..1; high set
 *    ramps from 0.2/0.3 (Near ≥ 0.3);
 *  - collision_clearance: min_collision_distance in METERS; danger at ≤ 0.0,
 *    near up to 0.05 (NEAR_COLLISION_DISTANCE), safe ≥ 0.05;
 *  - trajectory_complexity: waypoints / duration; high set starts at 10.
 *
 * These bands are PRESENTATION semantics (honest, threshold-anchored) — the
 * raw value always stays visible next to the reading.
 */

export type EvidenceTone = 'good' | 'warn' | 'danger'

/** The human reading of one evidence entry. */
export interface EvidenceReading {
  /** Human variable label, e.g. "Trajectory complexity". */
  label: string
  /** Short semantic reading for the bar, e.g. "Very high". */
  reading: string
  /** Semantic tone for coloring (green / amber / red). */
  tone: EvidenceTone
  /** Full factor-chip label, e.g. "Very high trajectory complexity". */
  chipLabel: string
  /** Narrative phrase, e.g. "trajectory complexity is very high". */
  phrase: string
  /** Display unit for the raw value ("m"), or null when dimensionless. */
  unit: string | null
}

interface Band {
  /** Inclusive lower bound; bands are matched top-down, descending `min`. */
  min: number
  reading: string
  tone: EvidenceTone
  chip: string
  phrase: string
}

interface VariableConfig {
  label: string
  /** +1 higher is worse, -1 lower is worse (risk contribution direction). */
  direction: 1 | -1
  unit: string | null
  bands: Band[]
}

const VARIABLES: Record<string, VariableConfig> = {
  manipulability: {
    label: 'Manipulability',
    direction: -1,
    unit: null,
    bands: [
      { min: 0.7, reading: 'Good', tone: 'good', chip: 'Good manipulability', phrase: 'manipulability is good' },
      { min: 0.3, reading: 'Moderate', tone: 'warn', chip: 'Moderate manipulability', phrase: 'manipulability is moderate' },
      { min: -Infinity, reading: 'Low', tone: 'danger', chip: 'Low manipulability', phrase: 'manipulability is low' },
    ],
  },
  singularity_proximity: {
    label: 'Singularity proximity',
    direction: 1,
    unit: null,
    bands: [
      { min: 0.3, reading: 'Near', tone: 'danger', chip: 'Near singularity', phrase: 'singularity proximity is high' },
      { min: 0.1, reading: 'Moderate', tone: 'warn', chip: 'Moderate singularity proximity', phrase: 'singularity proximity is moderate' },
      { min: -Infinity, reading: 'Low', tone: 'good', chip: 'Low singularity proximity', phrase: 'singularity proximity is low' },
    ],
  },
  collision_clearance: {
    label: 'Collision clearance',
    direction: -1,
    unit: 'm',
    bands: [
      { min: 0.05, reading: 'Safe', tone: 'good', chip: 'Safe clearance', phrase: 'collision clearance is safe' },
      { min: 0.0, reading: 'Reduced', tone: 'warn', chip: 'Reduced clearance', phrase: 'collision clearance is reduced' },
      { min: -Infinity, reading: 'Danger', tone: 'danger', chip: 'Collision danger', phrase: 'there is no collision clearance' },
    ],
  },
  trajectory_complexity: {
    label: 'Trajectory complexity',
    direction: 1,
    unit: null,
    bands: [
      { min: 10, reading: 'Very high', tone: 'danger', chip: 'Very high trajectory complexity', phrase: 'trajectory complexity is very high' },
      { min: 5, reading: 'Moderate', tone: 'warn', chip: 'Moderate trajectory complexity', phrase: 'trajectory complexity is moderate' },
      { min: -Infinity, reading: 'Low', tone: 'good', chip: 'Low trajectory complexity', phrase: 'trajectory complexity is low' },
    ],
  },
}

/** The four canonical evidence variables in display order. */
export const VARIABLE_ORDER: readonly string[] = [
  'manipulability',
  'singularity_proximity',
  'collision_clearance',
  'trajectory_complexity',
]

/** Human reading of one evidence entry, or `null` when the key is unknown —
 *  consumers then show the value only (never an invented reading). */
export function evidenceReading(key: string, value: number): EvidenceReading | null {
  const config = VARIABLES[key]
  if (!config) return null
  const band = config.bands.find((b) => value >= b.min) ?? config.bands[config.bands.length - 1]
  return {
    label: config.label,
    reading: band.reading,
    tone: band.tone,
    chipLabel: band.chip,
    phrase: band.phrase,
    unit: config.unit,
  }
}

/** Risk contribution direction (+1 higher worse, -1 lower worse, 0 unknown). */
export function evidenceDirection(key: string): 1 | -1 | 0 {
  return VARIABLES[key]?.direction ?? 0
}

/** snake_case wire key → sentence-case display label fallback (cosmetic only,
 *  matching the human label vocabulary: "Collision danger", not "Collision
 *  Danger"). */
export function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Human label for a raw variable name. Accepts both the wire snake_case keys
 *  ("collision_clearance") and the engine's Debug-formatted names used in trace
 *  binding keys ("CollisionClearance IS danger" prefix → "CollisionClearance").
 *  Unknown names fall back to a humanized sentence-case label. */
export function variableLabel(raw: string): string {
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
  return VARIABLES[normalized]?.label ?? humanizeKey(normalized)
}
