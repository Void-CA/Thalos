import { AlertTriangle, CheckCircle } from 'lucide-react'
import { factorRows, type FactorRow } from '@/shared/analysis/factor-rows'
import type { NarrativeFactor } from '@/shared/analysis/narrative-summary'

/** Icon / reading tint by semantic tone (green/amber/red). */
const TONE_CLASSES = {
  good: 'text-chart-3',
  warn: 'text-chart-4',
  danger: 'text-destructive',
} as const

/** Severity bar fill colors by semantic tone. */
const BAR_TONES = {
  good: 'bg-chart-3',
  warn: 'bg-chart-4',
  danger: 'bg-destructive',
} as const

/**
 * FactorRows (structural UX redesign) — the structured "why" of the verdict,
 * replacing the paragraph + factor chips: one scannable ROW per top factor
 * (icon | label | value | severity bar | reading), derived through the pure
 * `factorRows` helper (KB-anchored semantics from `evidence.ts`). Rows are
 * ranked by risk contribution; when the narrative's `primary_factors` are
 * supplied they select the rows, so the hero's one-liner and this list always
 * name the same factors. Problem factors read with an AlertTriangle, positive
 * with a CheckCircle. Unknown evidence keys never get a row (no invented
 * reading). All copy is English.
 */
export function FactorRows({
  evidence,
  primaryFactors,
}: {
  evidence: Record<string, number>
  primaryFactors?: NarrativeFactor[]
}) {
  const rows = factorRows(evidence)
  const selected =
    primaryFactors && primaryFactors.length > 0
      ? rows.filter((row) => primaryFactors.some((factor) => factor.key === row.key))
      : rows.slice(0, 4)
  if (selected.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5" data-testid="intelligence-factor-rows">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Why — Top factors
      </h3>
      <div className="flex flex-col">
        {selected.map((row) => (
          <FactorRowLine key={row.key} row={row} />
        ))}
      </div>
    </div>
  )
}

function FactorRowLine({ row }: { row: FactorRow }) {
  const problem = row.tone !== 'good'
  return (
    <div
      data-testid="factor-row"
      className="grid grid-cols-[1.25rem_minmax(0,11rem)_auto_minmax(0,1fr)_4.5rem] items-center gap-3 border-b border-border/60 py-2 last:border-b-0"
    >
      <span
        data-testid="factor-row-icon"
        data-icon={problem ? 'alert' : 'check'}
        className={TONE_CLASSES[row.tone]}
      >
        {problem ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
      </span>
      <span
        data-testid="factor-row-label"
        title={row.label}
        className="min-w-0 truncate text-sm font-medium text-foreground"
      >
        {row.label}
      </span>
      <span
        data-testid="factor-row-value"
        className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground"
      >
        {row.displayValue}
      </span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary" role="presentation">
        <div
          data-testid="factor-row-bar"
          className={`h-full rounded-full ${BAR_TONES[row.tone]}`}
          style={{ width: `${Math.round(row.risk * 100)}%` }}
        />
      </div>
      <span
        data-testid="factor-row-reading"
        data-tone={row.tone}
        className={`text-right text-xs font-semibold ${TONE_CLASSES[row.tone]}`}
      >
        {row.reading}
      </span>
    </div>
  )
}
