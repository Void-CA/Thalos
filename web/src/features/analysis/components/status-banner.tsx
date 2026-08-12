import { useAnalysisStore } from '../store'
import { severityCounts } from '@/shared/contracts/analysis-report'
import { gradeFromScore, type VerdictGrade } from '@/shared/analysis/verdict'
import type { AssessmentWire } from '@/shared/contracts/analysis-report'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'

type BannerState = 'good' | 'attention' | 'critical'

const GRADE_TONES: Record<VerdictGrade, string> = {
  Excellent: 'bg-success-weak text-chart-3',
  Good: 'bg-success-weak text-chart-3',
  Fair: 'bg-warning-weak text-chart-4',
  Poor: 'bg-destructive-weak text-destructive',
}

const RISK_TONES: Record<AssessmentWire['risk'], string> = {
  low: 'bg-success-weak text-chart-3',
  medium: 'bg-warning-weak text-chart-4',
  high: 'bg-warning-weak text-chart-5',
  critical: 'bg-destructive-weak text-destructive',
}

/**
 * StatusBanner — the SINGLE verdict display of the Evaluation workspace.
 * Shows the canonical Score /100 prominently + a grade pill (backend-aligned
 * score→grade) + a risk pill (secondary dimension, only when the report
 * carries an assessment) + the severity counts. The old derived
 * Good/Attention/Critical label is gone — it was a competing verdict
 * vocabulary ("Good" as a state next to "Good" as a grade).
 */
export function StatusBanner() {
  const report = useAnalysisStore(s => s.report)

  const counts = report ? severityCounts(report) : { error: 0, warning: 0, info: 0 }
  const bannerState: BannerState = counts.error > 0 ? 'critical'
    : counts.warning > 0 ? 'attention' : 'good'

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
  const score = report?.summary.score
  const grade = report ? gradeFromScore(report.summary.score) : null
  const risk = report?.assessment?.risk ?? null

  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border ${c.bg} ${c.border}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.text} bg-current`} />
        <span className="text-lg font-bold font-mono tabular-nums text-foreground leading-none">
          {score ?? '—'}
        </span>
        <span className="text-xs text-muted-foreground font-semibold tabular-nums">/ 100</span>
        {grade && (
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${GRADE_TONES[grade]}`}
          >
            {grade}
          </span>
        )}
        {risk && (
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RISK_TONES[risk]}`}
          >
            {risk}
          </span>
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
