import {
  evidenceReading,
  humanizeKey,
  VARIABLE_ORDER,
  type EvidenceTone,
} from '@/shared/analysis/evidence'

const BAR_TONES: Record<EvidenceTone, string> = {
  good: 'bg-chart-3',
  warn: 'bg-chart-4',
  danger: 'bg-destructive',
}

const READING_TONES: Record<EvidenceTone, string> = {
  good: 'text-chart-3',
  warn: 'text-chart-4',
  danger: 'text-destructive',
}

/**
 * MembershipBars — the "evidence" of the verdict, readable at a glance: one
 * bar per canonical evidence variable (Manipulability, Singularity proximity,
 * Collision clearance, Trajectory complexity) with a human label, the raw
 * value (with unit where it has one), a semantic reading derived from the
 * KB-anchored thresholds (`evidence.ts`), and a bar COLORED by that semantic —
 * not by the raw ratio alone. Derived/unknown evidence keys (the fuzzy
 * `MarkEvidence` flags) render as compact muted facts below, value only —
 * the UI never invents a reading for a key it cannot interpret. Values outside
 * 0..1 are clamped to the bar range (negative clearance clamps to 0 width).
 */
export function MembershipBars({ evidence }: { evidence: Record<string, number> }) {
  const variables = VARIABLE_ORDER
    .map((key) => ({ key, value: evidence[key] }))
    .filter((entry): entry is { key: string; value: number } => entry.value !== undefined)
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      reading: evidenceReading(entry.key, entry.value) as NonNullable<ReturnType<typeof evidenceReading>>,
    }))

  const derived = Object.entries(evidence).filter(([key]) => !VARIABLE_ORDER.includes(key))

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Evidence
      </h3>
      <div className="flex flex-col gap-2.5" data-testid="assessment-evidence">
        {variables.map(({ key, value, reading }) => {
          const pct = Math.min(Math.max(value, 0), 1) * 100
          return (
            <div
              key={key}
              data-testid="assessment-evidence-chip"
              className="flex items-center gap-3"
            >
              <div className="flex w-48 shrink-0 flex-col leading-tight sm:w-52">
                <span className="text-xs font-medium text-foreground">{reading.label}</span>
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                  {value.toFixed(3)}
                  {reading.unit ? ` ${reading.unit}` : ''}
                </span>
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary" role="presentation">
                <div
                  data-testid="membership-bar"
                  className={`h-full rounded-full ${BAR_TONES[reading.tone]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                data-testid="evidence-reading"
                className={`w-16 shrink-0 text-right text-[11px] font-semibold ${READING_TONES[reading.tone]}`}
              >
                {reading.reading}
              </span>
            </div>
          )
        })}
        {derived.length > 0 && (
          <div
            data-testid="evidence-derived"
            className="flex flex-wrap gap-1.5 border-t border-border pt-2"
          >
            {derived.map(([key, value]) => (
              <span
                key={key}
                className="rounded bg-secondary/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {humanizeKey(key)} · {value.toFixed(1)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
