import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'
import { gradeFromScore, verdictFromQuality, type VerdictGrade } from '@/shared/analysis/verdict'

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
 *
 * Score reconciliation (UX redesign: "which is which?"): the primary number is
 * the CANONICAL score the Evaluation tab shows — `report.summary.score` with
 * its backend-aligned grade (`gradeFromScore`). The assessment's `risk`
 * stays as the secondary badge (it expresses a different thing — safety).
 * Only when no report score is present does the gauge fall back to
 * `verdictFromQuality(assessment.quality)` (same projection the backend uses),
 * flagged with a subtle note. The two vocabularies can therefore never
 * contradict each other on screen.
 */
export function VerdictGauge({
  assessment,
  report,
}: {
  assessment: AssessmentWire
  report: AnalysisReportWire | null
}) {
  const reportScore = report?.summary.score
  const isFallback = reportScore === undefined || reportScore === null
  const primary = isFallback
    ? verdictFromQuality(assessment.quality)
    : { score: reportScore, grade: gradeFromScore(reportScore) }

  return (
    <div
      data-testid="assessment-verdict"
      className="flex items-end justify-between gap-4 rounded-lg border border-border bg-secondary/10 px-4 py-3"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Score</span>
        <span className="text-3xl font-bold font-mono tabular-nums text-foreground leading-none">
          {primary.score}
        </span>
        <span className="text-xs text-muted-foreground font-semibold tabular-nums">/ 100</span>
        <span
          className={`self-start rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${GRADE_TONES[primary.grade]}`}
        >
          {primary.grade}
        </span>
        {isFallback && (
          <span
            data-testid="verdict-source-note"
            className="self-start text-[10px] text-muted-foreground"
          >
            derived from assessment quality
          </span>
        )}
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
