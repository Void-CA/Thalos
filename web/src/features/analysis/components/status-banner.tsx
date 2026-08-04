import { useAnalysisStore } from '../store'
import { severityCounts } from '@/shared/contracts/analysis-report'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'

type BannerState = 'good' | 'attention' | 'critical'

/**
 * StatusBanner — barra de estado horizontal con score, severity distribution.
 * Derives entirely from the canonical AnalysisReport (I3: interpretation from
 * observation severities; I7: single score = summary.score).
 */
export function StatusBanner() {
  const report = useAnalysisStore(s => s.report)

  const counts = report ? severityCounts(report) : { error: 0, warning: 0, info: 0 }
  const bannerState: BannerState = counts.error > 0 ? 'critical'
    : counts.warning > 0 ? 'attention' : 'good'

  const stateLabel = bannerState === 'critical' ? 'Critical'
    : bannerState === 'attention' ? 'Attention' : 'Good'

  const errorCount = counts.error
  const warnCount = counts.warning
  const infoCount = counts.info

  const colors: Record<BannerState, { bg: string; border: string; text: string }> = {
    good: { bg: 'bg-success-weak', border: 'border-success-mid', text: 'text-chart-3' },
    attention: { bg: 'bg-warning-weak', border: 'border-warning-mid', text: 'text-chart-4' },
    critical: { bg: 'bg-destructive-weak', border: 'border-destructive-mid', text: 'text-destructive' },
  }

  const c = colors[bannerState]
  const total = errorCount + warnCount + infoCount

  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border ${c.bg} ${c.border}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.text} bg-current`} />
        <span className={`text-sm font-bold uppercase tracking-wider ${c.text}`}>{stateLabel}</span>
        <span className="text-xs text-muted-foreground font-semibold tabular-nums">
          {report?.summary.score ?? '—'} / 100
        </span>
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2.5 shrink-0">
          {errorCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive tabular-nums">
              <AlertCircle className="h-3.5 w-3.5" /> {errorCount}
            </span>
          )}
          {warnCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-chart-4 tabular-nums">
              <AlertTriangle className="h-3.5 w-3.5" /> {warnCount}
            </span>
          )}
          {infoCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground tabular-nums">
              <Info className="h-3.5 w-3.5" /> {infoCount}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
