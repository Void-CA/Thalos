import type { HistogramBin } from './histogram'

/**
 * HistogramBars — lightweight CSS bar rendering for the inline distribution
 * report. No ECharts: for a 10-bin inline histogram inside the accordion a
 * flex row of proportional bars is simpler and carries zero new deps.
 * The full value range is labeled at the ends; each bar's exact bin range and
 * count are available on hover (title).
 */
export function HistogramBars({
  data,
  color = 'var(--chart-1)',
  formatValue,
}: {
  data: HistogramBin[]
  color?: string
  formatValue?: (value: number) => string
}) {
  if (data.length === 0) return null
  const maxCount = Math.max(...data.map((bin) => bin.count))
  const fmt = formatValue ?? ((value: number) => value.toFixed(2))

  return (
    <div>
      <div className="flex items-end gap-[2px] h-12" role="img" aria-label="Distribution histogram">
        {data.map((bin) => (
          <div
            key={bin.bin}
            title={`${fmt(bin.start)}–${fmt(bin.end)}: ${bin.count}`}
            className="flex-1 rounded-t-sm transition-colors hover:opacity-80"
            style={{
              height: `${maxCount === 0 ? 0 : Math.max(8, (bin.count / maxCount) * 100)}%`,
              backgroundColor: color,
            }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 font-mono tabular-nums">
        <span>{fmt(data[0].start)}</span>
        <span>{fmt(data[data.length - 1].end)}</span>
      </div>
    </div>
  )
}

/** One categorical bar — used for the singularity state breakdown. */
export interface CategoryBar {
  label: string
  count: number
  color: string
}

/**
 * CategoricalBars — horizontal bar breakdown for nominal categories (singularity
 * state counts). Renders the count label beside each bar so the metric grid
 * stays the primary display and this stays a cheap visual add-on.
 */
export function CategoricalBars({ categories }: { categories: CategoryBar[] }) {
  const maxCount = Math.max(...categories.map((category) => category.count), 1)
  return (
    <div className="flex flex-col gap-1">
      {categories.map((category) => (
        <div key={category.label} className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground w-20 shrink-0">{category.label}</span>
          <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${(category.count / maxCount) * 100}%`,
                backgroundColor: category.color,
              }}
            />
          </div>
          <span className="font-mono tabular-nums text-foreground w-12 text-right shrink-0">
            {category.count}
          </span>
        </div>
      ))}
    </div>
  )
}
