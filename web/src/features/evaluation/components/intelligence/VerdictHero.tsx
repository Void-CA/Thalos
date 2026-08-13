import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'
import { gradeFromScore, type VerdictGrade } from '@/shared/analysis/verdict'

/** Risk-band tint for the decision band: strong border + colored verdict word,
 *  so the AI verdict is unmistakable (not a `-weak` wash). */
const RISK_BAND: Record<AssessmentWire['risk'], string> = {
  low: 'border-success-mid/70 bg-success-weak',
  medium: 'border-warning-mid bg-warning-weak/70',
  high: 'border-warning-mid bg-warning-weak/80',
  critical: 'border-destructive-mid bg-destructive-weak/80',
}

/** The verdict WORD color — the strong accent that carries the verdict. */
const RISK_WORD: Record<AssessmentWire['risk'], string> = {
  low: 'text-chart-3',
  medium: 'text-chart-4',
  high: 'text-chart-5',
  critical: 'text-destructive',
}

/** Inline grade tone for the secondary analyzer-health context. */
const GRADE_TONES: Record<VerdictGrade, string> = {
  Excellent: 'text-chart-3',
  Good: 'text-chart-3',
  Fair: 'text-chart-4',
  Poor: 'text-destructive',
}

/**
 * VerdictHero (v3 — the AI verdict is the protagonist) — the decision band at
 * the top of the Intelligence tab. Semantics follow the frozen system:
 *
 *   HIGH
 *   Risk 0.557 · Quality 44.3%
 *   Singular event detected → risk elevated to High
 *
 * - The categorical verdict WORD is the primary statement, large and strongly
 *   colored (the risk accent), with the crisp risk + quality derived from the
 *   ASSESSOR (`quality = 1 − crisp risk`) directly beneath.
 * - The `whyLine` (elevation story) sits immediately after — the verdict did
 *   not appear magically.
 * - The ANALYZER's `health` (`report.summary.score` + grade — a strict
 *   fault-penalty score) is clearly-labeled SECONDARY context, never competing
 *   visually with the intelligent diagnosis.
 * - The human narrative summary (regions) renders as secondary detail.
 */
export function VerdictHero({
  assessment,
  report,
  summary,
  whyLine,
}: {
  assessment: AssessmentWire
  report: AnalysisReportWire | null
  summary: string
  whyLine?: string | null
}) {
  const crisp = 1 - assessment.quality
  const qualityPct = assessment.quality * 100
  const reportScore = report?.summary.score
  const grade = reportScore !== undefined && reportScore !== null ? gradeFromScore(reportScore) : null

  return (
    <div
      data-testid="intelligence-verdict-hero"
      className={`flex flex-col gap-3 rounded-lg border p-5 ${RISK_BAND[assessment.risk]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span
            data-testid="verdict-risk-word"
            className={`text-4xl font-bold uppercase leading-none tracking-tight ${RISK_WORD[assessment.risk]}`}
          >
            {assessment.risk}
          </span>
          <span
            data-testid="verdict-risk-quality"
            className="text-sm font-medium tabular-nums text-foreground/90"
          >
            Risk {crisp.toFixed(3)} · Quality {qualityPct.toFixed(1)}%
          </span>
        </div>
        {reportScore !== undefined && reportScore !== null && grade && (
          <span
            data-testid="analyzer-health"
            className="rounded-md border border-border bg-card/70 px-2 py-1 text-right text-[10px] leading-tight text-muted-foreground"
          >
            <span className="block font-semibold">
              Analyzer health: {reportScore} <span className={GRADE_TONES[grade]}>{grade}</span>
            </span>
            <span className="block text-muted-foreground/70">strict fault-penalty score</span>
          </span>
        )}
      </div>
      {whyLine && (
        <p data-testid="verdict-why" className="text-sm font-semibold text-foreground">
          {whyLine}
        </p>
      )}
      <p
        data-testid="verdict-summary"
        className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground"
      >
        {summary}
      </p>
    </div>
  )
}
