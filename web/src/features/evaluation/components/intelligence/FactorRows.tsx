import { factorRows, type FactorRow } from '@/shared/analysis/factor-rows'
import type { NarrativeFactor } from '@/shared/analysis/narrative-summary'

/** Reading tint by semantic tone (green/amber/red). */
const TONE_CLASSES = {
  good: 'text-chart-3',
  warn: 'text-chart-4',
  danger: 'text-destructive',
} as const

/**
 * FactorRows — the structured "why" of the verdict, scannable in seconds: one
 * compact ROW per top factor (label | value | reading), derived through the
 * pure `factorRows` helper (KB-anchored semantics from `evidence.ts`). Rows are
 * ranked by risk contribution; when the narrative's `primary_factors` are
 * supplied they select the rows, so the hero's one-liner and this list always
 * name the same factors. The reading color carries the tone (no bars, no card
 * walls — the information is the hierarchy). All copy is English.
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
    <div className="flex flex-col gap-2" data-testid="intelligence-factor-rows">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Assessment factors
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
  return (
    <div
      data-testid="factor-row"
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b border-border/60 py-2 last:border-b-0"
    >
      <span
        data-testid="factor-row-label"
        title={row.label}
        className="min-w-0 truncate text-sm text-muted-foreground"
      >
        {row.label}
      </span>
      <span
        data-testid="factor-row-value"
        className="font-mono text-sm font-medium tabular-nums text-foreground"
      >
        {row.displayValue}
      </span>
      <span
        data-testid="factor-row-reading"
        data-tone={row.tone}
        className={`w-20 text-right text-sm font-semibold ${TONE_CLASSES[row.tone]}`}
      >
        {row.reading}
      </span>
    </div>
  )
}
