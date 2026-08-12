import { buildNarrativeSummary } from '@/shared/analysis/narrative-summary'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'

/** Risk-tier accent for the hero card: the border/background is tinted by the
 *  categorical verdict (critical → destructive tones, high/medium → warning
 *  tones, low → neutral). Reuses existing semantic tokens only. */
const RISK_ACCENT: Record<AssessmentWire['risk'], string> = {
  low: 'border-border bg-secondary/10',
  medium: 'border-warning-mid bg-warning-weak/50',
  high: 'border-warning-mid bg-warning-weak',
  critical: 'border-destructive-mid bg-destructive-weak',
}

/**
 * NarrativeSummaryCard (intelligible-repair-loop 2.1) — the HERO of the
 * Intelligence tab: large verdict headline + grounded summary + primary
 * factor chips, derived from the assessment + problem regions ONLY through
 * `buildNarrativeSummary` (pure view model — see
 * `web/src/shared/analysis/narrative-summary.ts`). The card renders nothing
 * when the assessment is absent. All copy is English.
 */
export function NarrativeSummaryCard({
  assessment,
  regions,
}: {
  assessment: AssessmentWire | null
  regions: ProblemRegionWire[]
}) {
  if (!assessment) return null
  const narrative = buildNarrativeSummary(assessment, regions)

  return (
    <div
      data-testid="narrative-summary"
      className={`flex flex-col gap-2.5 rounded-lg border p-4 ${RISK_ACCENT[assessment.risk]}`}
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Narrative Summary
      </span>
      <h3 className="text-lg font-semibold leading-snug text-foreground">{narrative.headline}</h3>
      <p className="max-w-[65ch] text-sm leading-relaxed text-foreground">{narrative.summary}</p>
      {narrative.primary_factors.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="narrative-factors">
          {narrative.primary_factors.map((factor) => (
            <span
              key={factor.key}
              data-testid="narrative-factor-chip"
              // The key is the traceability anchor back to the input evidence.
              title={factor.key}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground"
            >
              {factor.label}
            </span>
          ))}
        </div>
      )}
      {narrative.recommendation_context && (
        <p className="text-xs leading-relaxed text-muted-foreground">{narrative.recommendation_context}</p>
      )}
    </div>
  )
}
