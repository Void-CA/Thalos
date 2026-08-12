import type { AssessmentWire } from '@/shared/contracts/analysis-report'

/** Qualitative quality band derived from the 0..1 quality score (spec
 *  evaluation-intelligence-tab verdict gauge: "Quality: GOOD / 0.82"). */
export function qualityLabel(quality: number): string {
  if (quality >= 0.7) return 'GOOD'
  if (quality >= 0.4) return 'FAIR'
  return 'POOR'
}

/** Color-coded risk badge tones (green/yellow/orange/red). */
const RISK_TONES: Record<AssessmentWire['risk'], string> = {
  low: 'bg-success-weak text-chart-3',
  medium: 'bg-warning-weak text-chart-4',
  high: 'bg-warning-weak text-chart-5',
  critical: 'bg-destructive-weak text-destructive',
}

/**
 * VerdictGauge — the large Quality + Risk verdict of the intelligent
 * assessment. Quality shows the 0..1 score with a qualitative band (GOOD /
 * FAIR / POOR); Risk shows the categorical level. Purely presentational —
 * the wire carries the risk category, so no numeric risk is invented here.
 */
export function VerdictGauge({ assessment }: { assessment: AssessmentWire }) {
  return (
    <div
      data-testid="assessment-verdict"
      className="flex items-end justify-between gap-4 rounded-lg border border-border bg-secondary/10 px-4 py-3"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Quality Score</span>
        <span className="text-3xl font-bold font-mono tabular-nums text-foreground leading-none">
          {assessment.quality.toFixed(2)}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">
          {qualityLabel(assessment.quality)}
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
