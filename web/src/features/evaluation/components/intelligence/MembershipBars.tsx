import {
  evidenceReading,
  humanizeKey,
  VARIABLE_ORDER,
  type EvidenceTone,
} from '@/shared/analysis/evidence'

const READING_TONES: Record<EvidenceTone, string> = {
  good: 'text-chart-3',
  warn: 'text-chart-4',
  danger: 'text-destructive',
}

interface EvidenceRow {
  key: string
  label: string
  value: number
  unit: string | null
  reading: string | null
  tone: EvidenceTone | null
}

/**
 * MembershipBars — the "evidence" of the verdict, readable at a glance: one row
 * per canonical evidence variable (Manipulability, Singularity proximity,
 * Collision clearance, Trajectory complexity) with a human label, the raw value
 * (with unit where it has one) and a semantic reading derived from the
 * KB-anchored thresholds (`evidence.ts`), tone-colored by that semantic — not
 * by the raw ratio alone. An evidence audit reads as a TABLE, matching
 * RuleReasoning's visual language inside Technical Details: a dense `w-full`
 * `table-fixed` table (Evidence / Value / Reading), no per-row backgrounds, no
 * bars. Derived/unknown evidence keys (the fuzzy `MarkEvidence` flags) fold in
 * as extra rows with the value and a "—" reading — the UI never invents a
 * reading for a key it cannot interpret.
 */
export function MembershipBars({ evidence }: { evidence: Record<string, number> }) {
  const rows: EvidenceRow[] = VARIABLE_ORDER
    .map((key) => ({ key, value: evidence[key] }))
    .filter((entry): entry is { key: string; value: number } => entry.value !== undefined)
    .map((entry) => {
      const reading = evidenceReading(entry.key, entry.value)!
      return {
        key: entry.key,
        label: reading.label,
        value: entry.value,
        unit: reading.unit,
        reading: reading.reading,
        tone: reading.tone,
      }
    })

  const derived: EvidenceRow[] = Object.entries(evidence)
    .filter(([key]) => !VARIABLE_ORDER.includes(key))
    .map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value,
      unit: null,
      reading: null,
      tone: null,
    }))

  const allRows = [...rows, ...derived]

  return (
    <div className="flex flex-col gap-2" data-testid="assessment-evidence">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Evidence · fuzzification inputs
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[50%] border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Evidence
              </th>
              <th
                scope="col"
                className="w-[25%] border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Value
              </th>
              <th
                scope="col"
                className="w-[25%] border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Reading
              </th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, index) => (
              <tr
                key={row.key}
                data-testid="evidence-row"
                className={index < allRows.length - 1 ? 'border-b border-border' : ''}
              >
                <td className="px-3 py-2 align-top">
                  <span className="text-sm font-medium text-foreground">{row.label}</span>
                </td>
                <td className="px-3 py-2 align-top font-mono text-sm tabular-nums text-muted-foreground">
                  {row.value.toFixed(3)}
                  {row.unit ? ` ${row.unit}` : ''}
                </td>
                <td
                  data-testid="evidence-reading"
                  className={`px-3 py-2 align-top text-sm font-semibold ${
                    row.tone ? READING_TONES[row.tone] : 'text-muted-foreground'
                  }`}
                >
                  {row.reading ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
