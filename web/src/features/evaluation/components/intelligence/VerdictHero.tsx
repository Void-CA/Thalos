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

/** Inline grade tone (canonical score→grade language): the grade word sits
 *  baseline-aligned next to the number as ONE statement — colored text only,
 *  no pill chrome, so the number + word read as a single verdict. */
const GRADE_TONES: Record<VerdictGrade, string> = {
  Excellent: 'text-chart-3',
  Good: 'text-chart-3',
  Fair: 'text-chart-4',
  Poor: 'text-destructive',
}

/** Fill tone for the 0–100 score scale, keyed by the grade (the accent carries
 *  the verdict; the track stays monochrome). */
const SCALE_TONES: Record<VerdictGrade, string> = {
  Excellent: 'bg-chart-3',
  Good: 'bg-chart-3',
  Fair: 'bg-chart-4',
  Poor: 'bg-destructive',
}

/** Color-coded risk chip tones (green/yellow/orange/red). */
const RISK_TONES: Record<AssessmentWire['risk'], string> = {
  low: 'bg-success-weak text-chart-3',
  medium: 'bg-warning-weak text-chart-4',
  high: 'bg-warning-weak text-chart-5',
  critical: 'bg-destructive-weak text-destructive',
}

/**
 * VerdictHero (UX redesign v2) — the decision band at the top of the
 * Intelligence tab: ONE full-width band tinted by RISK carrying a single
 * dominant statement — the big score with the grade word INLINE (baseline-
 * aligned, colored, not a pill) — anchored on a thin 0–100 score scale, with
 * risk demoted to a small secondary chip and one human summary line. No
 * uppercase "Score"/"Risk Level" labels: the hierarchy carries the meaning.
 * This is the ONLY verdict number on the tab — the old gauge is gone.
 *
 * Score reconciliation (P1.1 — kept): the primary number is the canonical
 * score the Evaluation tab shows — `report.summary.score` with its
 * backend-aligned grade (`gradeFromScore`). The assessment's `risk` stays as
 * the secondary chip (it expresses a different thing — safety). Only when no
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
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <span className="flex items-baseline gap-2">
            <span
              data-testid="verdict-score"
              className="text-5xl font-bold leading-none font-mono tabular-nums text-foreground"
            >
              {primary.score}
            </span>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              / 100
            </span>
            <span
              data-testid="verdict-grade"
              className={`text-xl font-bold tracking-tight ${GRADE_TONES[primary.grade]}`}
            >
              {primary.grade}
            </span>
          </span>
          <div
            data-testid="verdict-scale"
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-border"
            aria-hidden="true"
          >
            <div
              data-testid="verdict-scale-fill"
              className={`absolute inset-y-0 left-0 rounded-full ${SCALE_TONES[primary.grade]}`}
              style={{ width: `${primary.score}%` }}
            />
          </div>
        </div>
        <span
          data-testid="verdict-risk"
          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${RISK_TONES[assessment.risk]}`}
        >
          {assessment.risk} risk
        </span>
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
