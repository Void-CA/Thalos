import type { AssessmentWire } from '@/shared/contracts/analysis-report'
import { verdictFromQuality, type VerdictGrade } from '@/shared/analysis/verdict'

/** Color-coded grade pill tones (canonical score→grade language). */
const GRADE_TONES: Record<VerdictGrade, string> = {
  Excellent: 'bg-success-weak text-chart-3',
  Good: 'bg-success-weak text-chart-3',
  Fair: 'bg-warning-weak text-chart-4',
  Poor: 'bg-destructive-weak text-destructive',
}

/** Color-coded risk badge tones (green/yellow/orange/red). */
const RISK_TONES: Record<AssessmentWire['risk'], string> = {
  low: 'bg-success-weak text-chart-3',
  medium: 'bg-warning-weak text-chart-4',
  high: 'bg-warning-weak text-chart-5',
  critical: 'bg-destructive-weak text-destructive',
}

/**
 * VerdictGauge — the large Score + Risk verdict of the intelligent assessment.
 * The primary number is the CANONICAL score (0–100, derived from
 * `assessment.quality × 100` with the same projection as the backend DTO) with
 * its backend-aligned grade pill; Risk stays as the secondary badge. Purely
 * presentational — the wire carries the risk category and the quality, no
 * numeric risk is invented here.
 */
export function VerdictGauge({ assessment }: { assessment: AssessmentWire }) {
  const verdict = verdictFromQuality(assessment.quality)
  return (
    <div
      data-testid="assessment-verdict"
      className="flex items-end justify-between gap-4 rounded-lg border border-border bg-secondary/10 px-4 py-3"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Score</span>
        <span className="text-3xl font-bold font-mono tabular-nums text-foreground leading-none">
          {verdict.score}
        </span>
        <span className="text-xs text-muted-foreground font-semibold tabular-nums">/ 100</span>
        <span
          className={`self-start rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${GRADE_TONES[verdict.grade]}`}
        >
          {verdict.grade}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Risk Level</span>
        <span
          className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${RISK_TONES[assessment.risk]}`}
        >
          {assessment.risk}
        </span>
      </div>
    </div>
  )
}
