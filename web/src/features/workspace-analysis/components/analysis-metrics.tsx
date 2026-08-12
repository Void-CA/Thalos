import type { ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

/**
 * Shared metric display components for workspace analysis results.
 *
 * Extracted from the old analysis-dialog.tsx modal (PR-C): the inline
 * WorkspaceAnalysis section reuses the same visual language (progress bars,
 * value cards, grade badges) without the modal wrapper.
 */

export function SectionHeader({ title, badge }: { title: string; badge?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">{title}</h3>
      {badge}
    </div>
  )
}

export function MetricRow({
  label, value, max, unit, inverse, pct,
}: {
  label: string
  value: number
  max: number
  unit?: string
  inverse?: boolean
  pct?: boolean
}) {
  const pctVal = pct ? (value ?? 0) * 100 : inverse
    ? Math.max(0, Math.min(100, ((max - (value ?? 0)) / max) * 100))
    : Math.max(0, Math.min(100, ((value ?? 0) / max) * 100))

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-foreground font-semibold">
          {value?.toFixed?.(4) ?? '—'}
          {unit && <span className="text-muted-foreground font-normal ml-0.5">{unit}</span>}
          {pct && <span className="text-muted-foreground font-normal">%</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pctVal}%`,
            backgroundColor: inverse
              ? pctVal > 60 ? '#44cc44' : pctVal > 30 ? '#eebb22' : '#ee3333'
              : pctVal > 60 ? '#44cc44' : pctVal > 30 ? '#eebb22' : '#ee3333',
          }}
        />
      </div>
    </div>
  )
}

export function MetricRange({
  label, min, max, unit, pct,
}: {
  label: string
  min?: number
  max?: number
  unit?: string
  pct?: boolean
}) {
  const fmt = (v?: number) => (v == null ? '—' : v.toFixed(2))
  const suffix = pct ? '%' : unit
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">
        <span className="text-muted-foreground">{fmt(min)}</span>
        <span className="text-foreground mx-1">—</span>
        <span className="text-foreground font-semibold">{fmt(max)}</span>
        {suffix && <span className="text-muted-foreground font-normal ml-0.5">{suffix}</span>}
      </span>
    </div>
  )
}

export function MetricValue({
  label, value, color, pct, unit,
}: {
  label: string
  value?: number
  color?: string
  pct?: boolean
  unit?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-secondary/20 rounded-md px-2.5 py-2">
      <span className="text-[10px] text-muted-foreground truncate">{label}</span>
      <span className="text-sm font-mono font-semibold tabular-nums" style={{ color: color ?? 'var(--foreground)' }}>
        {value?.toFixed?.(4) ?? '—'}
        {pct && <span className="text-[10px] text-muted-foreground font-normal">%</span>}
        {unit && <span className="text-[10px] text-muted-foreground font-normal">{unit}</span>}
      </span>
    </div>
  )
}

export function gradeBadge(singularCount: number, total: number): ReactNode {
  if (!total) return null
  const ratio = singularCount / total
  const isGood = ratio < 0.01
  const isWarn = ratio < 0.05
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
      isGood ? 'bg-success-weak text-chart-3' : isWarn ? 'bg-warning-weak text-chart-4' : 'bg-destructive-weak text-destructive'
    }`}>
      {isGood ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {isGood ? 'Good' : isWarn ? 'Fair' : 'Poor'}
    </span>
  )
}

export function gradeBadgeInverse(value: number): ReactNode {
  if (value === undefined) return null
  const isGood = value >= 0.5
  const isWarn = value >= 0.3
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
      isGood ? 'bg-success-weak text-chart-3' : isWarn ? 'bg-warning-weak text-chart-4' : 'bg-destructive-weak text-destructive'
    }`}>
      {isGood ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {isGood ? 'Good' : isWarn ? 'Fair' : 'Poor'}
    </span>
  )
}
