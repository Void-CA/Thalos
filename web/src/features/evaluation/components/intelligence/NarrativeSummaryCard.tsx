import { buildNarrativeSummary } from '@/shared/analysis/narrative-summary'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'

/**
 * NarrativeSummaryCard (intelligible-repair-loop 2.1) — the intelligible
 * narrative of the Intelligence tab: headline + grounded summary + primary
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
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/10 px-3 py-2.5"
    >
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Narrative Summary
      </h3>
      <p className="text-sm font-semibold text-foreground">{narrative.headline}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{narrative.summary}</p>
      {narrative.primary_factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="narrative-factors">
          {narrative.primary_factors.map((factor) => (
            <span
              key={factor.key}
              data-testid="narrative-factor-chip"
              // The key is the traceability anchor back to the input evidence.
              title={factor.key}
              className="rounded border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-foreground"
            >
              {factor.label}
            </span>
          ))}
        </div>
      )}
      {narrative.recommendation_context && (
        <p className="text-[10px] text-muted-foreground">{narrative.recommendation_context}</p>
      )}
    </div>
  )
}
