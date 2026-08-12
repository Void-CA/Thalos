import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'
import { gradeFromScore, verdictFromQuality, type VerdictGrade } from '@/shared/analysis/verdict'

/** Risk-tier accent for the decision band: the WHOLE band is tinted by the
 *  categorical verdict (critical → destructive tones, high/medium → warning
 *  tones, low → neutral/success). Reuses existing semantic tokens only. */
const RISK_ACCENT: Record<AssessmentWire['risk'], string> = {
  low: 'border-success-mid/60 bg-success-weak',
  medium: 'border-warning-mid bg-warning-weak/50',
  high: 'border-warning-mid bg-warning-weak',
  critical: 'border-destructive-mid bg-destructive-weak',
}

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
 * VerdictHero (structural UX redesign) — the decision band at the top of the
 * Intelligence tab: ONE full-width band tinted by RISK, carrying the canonical
 * score (the number dominates), grade pill, risk badge and a single human
 * summary line. This is the ONLY verdict number on the tab — the old gauge is
 * gone.
 *
 * Score reconciliation (P1.1 — kept): the primary number is the canonical
 * score the Evaluation tab shows — `report.summary.score` with its
 * backend-aligned grade (`gradeFromScore`). The assessment's `risk` stays as
 * the secondary badge (it expresses a different thing — safety). Only when no
 * report score is present does the hero fall back to
 * `verdictFromQuality(assessment.quality)` (same projection the backend uses),
 * flagged with a subtle note. The two vocabularies can therefore never
 * contradict each other on screen.
 *
 * `summary` is the human one-liner from `buildNarrativeSummary` (English
 * phrasing — never raw rule ids / evidence keys). All copy is English.
 */
export function VerdictHero({
  assessment,
  report,
  summary,
}: {
  assessment: AssessmentWire
  report: AnalysisReportWire | null
  summary: string
}) {
  const reportScore = report?.summary.score
  const isFallback = reportScore === undefined || reportScore === null
  const primary = isFallback
    ? verdictFromQuality(assessment.quality)
    : { score: reportScore, grade: gradeFromScore(reportScore) }

  return (
    <div
      data-testid="intelligence-verdict-hero"
      className={`flex flex-col gap-3 rounded-lg border p-5 ${RISK_ACCENT[assessment.risk]}`}
    >
      <div
        data-testid="assessment-verdict"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Score
            </span>
            <span className="flex items-baseline gap-1.5">
              <span
                data-testid="verdict-score"
                className="text-5xl font-bold leading-none font-mono tabular-nums text-foreground"
              >
                {primary.score}
              </span>
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                / 100
              </span>
            </span>
          </div>
          <span
            data-testid="verdict-grade"
            className={`self-start rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${GRADE_TONES[primary.grade]}`}
          >
            {primary.grade}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Risk Level</span>
          <span
            data-testid="verdict-risk"
            className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${RISK_TONES[assessment.risk]}`}
          >
            {assessment.risk}
          </span>
        </div>
      </div>
      <p
        data-testid="verdict-summary"
        className="max-w-[65ch] text-sm leading-relaxed text-foreground"
      >
        {summary}
      </p>
      {isFallback && (
        <span
          data-testid="verdict-source-note"
          className="self-start text-[10px] text-muted-foreground"
        >
          derived from assessment quality
        </span>
      )}
    </div>
  )
}
