import { useAnalysisStore } from '../store'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'

type BannerState = 'good' | 'attention' | 'critical'

/**
 * StatusBanner — barra de estado horizontal con score, severity distribution.
 * Matching Angular status-banner.ts.
 */
export function StatusBanner() {
  const summary = useAnalysisStore(s => s.summary)
  const findings = useAnalysisStore(s => s.findings)

  const bannerState: BannerState = summary?.status === 'error' ? 'critical'
    : summary?.status === 'warning' ? 'attention' : 'good'

  const stateLabel = summary?.status === 'error' ? 'Critical'
    : summary?.status === 'warning' ? 'Attention' : 'Good'

  const errorCount = findings.filter(f => f.severity === 'error').length
  const warnCount = findings.filter(f => f.severity === 'warning').length
  const infoCount = findings.filter(f => f.severity === 'info').length

  const colors: Record<BannerState, { bg: string; border: string; text: string }> = {
    good: { bg: 'bg-chart-3/10', border: 'border-chart-3/30', text: 'text-chart-3' },
    attention: { bg: 'bg-chart-4/10', border: 'border-chart-4/30', text: 'text-chart-4' },
    critical: { bg: 'bg-destructive/10', border: 'border-destructive/30', text: 'text-destructive' },
  }

  const c = colors[bannerState]
  const total = findings.length

  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border ${c.bg} ${c.border}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.text} bg-current`} />
        <span className={`text-sm font-bold uppercase tracking-wider ${c.text}`}>{stateLabel}</span>
        <span className="text-xs text-muted-foreground font-semibold tabular-nums">
          {summary?.score ?? '—'} / 100
        </span>
        {summary?.message && (
          <span className="text-xs text-muted-foreground truncate hidden sm:inline">{summary.message}</span>
        )}
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
