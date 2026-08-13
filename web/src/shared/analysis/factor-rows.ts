/**
 * Factor rows — the structured "why" of the Intelligence verdict (structural
 * UX redesign). Pure: an evidence map in, a ranked list of `FactorRow`s out.
 *
 * Each row derives from the KB-anchored semantics in `evidence.ts`
 * (`evidenceReading` / `evidenceDirection`): human chip label, semantic tone,
 * reading text, display unit. Unknown keys yield NO row — the UI never invents
 * a reading for a key it cannot interpret (same traceability invariant as
 * `narrative-summary.ts`).
 *
 * Ranking: `risk` is the 0..1 risk contribution of the variable (0 = best,
 * 1 = worst), direction-aware — for lower-is-worse variables it is `1 - value`,
 * for higher-is-worse it is the value, clamped to [0,1]. Rows sort by risk
 * descending so the biggest problem leads. The same projection the hero's
 * summary sentence uses, so the one-liner and the factor list always agree.
 */

import { evidenceDirection, evidenceReading, type EvidenceTone } from './evidence'

export interface FactorRow {
  /** Evidence key — MUST exist in the input evidence (traceability). */
  key: string
  /** Human factor label, e.g. "Low manipulability". */
  label: string
  /** Raw wire value. */
  value: number
  /** Raw value rendered for display, with the unit where the variable has one. */
  displayValue: string
  /** Semantic reading text, e.g. "Very high", "Low", "Near". */
  reading: string
  /** Semantic tone (green / amber / red). */
  tone: EvidenceTone
  /** Risk contribution in [0,1] (0 = best, 1 = worst) — ranks the rows. */
  risk: number
}

/** Raw value rendered readably: trailing zeros trimmed, unit appended. */
export function formatEvidenceValue(value: number, unit: string | null): string {
  const trimmed = Number(value.toFixed(3))
  return unit ? `${trimmed} ${unit}` : String(trimmed)
}

/** 0..1 risk contribution of one evidence entry (0 = best, 1 = worst). */
function riskContribution(key: string, value: number): number {
  const direction = evidenceDirection(key)
  if (direction === 0) return 0
  const raw = direction < 0 ? 1 - value : value
  return Math.min(Math.max(raw, 0), 1)
}

/** The ranked factor rows for the input evidence (known variables only). */
export function factorRows(evidence: Record<string, number>): FactorRow[] {
  return Object.entries(evidence)
    .map(([key, value]) => {
      const reading = evidenceReading(key, value)
      if (!reading) return null
      return {
        key,
        label: reading.chipLabel,
        value,
        displayValue: formatEvidenceValue(value, reading.unit),
        reading: reading.reading,
        tone: reading.tone,
        risk: riskContribution(key, value),
      }
    })
    .filter((row): row is FactorRow => row !== null)
    .sort((a, b) => b.risk - a.risk)
}
