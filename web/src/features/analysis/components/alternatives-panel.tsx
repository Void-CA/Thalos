import { useMutation } from '@tanstack/react-query'
import { planAnalysisApi } from '../api/plan-analysis-api'
import { repairOptionsBuilder } from '@/shared/charts/builders/repair-options'
import type { RepairOptionCardView } from '@/shared/charts/builders/repair-options'
import { Wrench, Loader2 } from 'lucide-react'
import { ErrorBox } from '@/components/ui/error-box'

/**
 * AlternativesPanel — repair options for the active plan (S4, spec
 * alternatives-panel-react).
 *
 * Consumes the CANONICAL endpoint `POST /plan/repair/options` ONLY (I1). The
 * deprecated `/plan/analyze/alternatives` route no longer exists in the api
 * client (C1/C2) — wiring it back cannot compile.
 *
 * The component is a PURE CONSUMER (C3): ALL presentation mapping happens in
 * the pure `repairOptionsBuilder` (shared/charts/builders). The panel reads
 * nothing from the wire directly and formats nothing — it renders the builder's
 * display-ready card views verbatim.
 *
 * Empty state derives from the DOMAIN (C4): `repairs = []` → the builder's
 * `empty.message` ("No alternatives available"), never a component guess.
 */
export function AlternativesPanel() {
  const query = useMutation({
    mutationFn: () => planAnalysisApi.repairOptions(),
  })

  const model = query.data ? repairOptionsBuilder(query.data) : null

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => query.mutate()}
        disabled={query.isPending}
        className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium
                   rounded-lg border border-primary-mid bg-primary-weak text-primary
                   hover:bg-primary-weak transition-all cursor-pointer disabled:opacity-40"
      >
        {query.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
        {query.isPending ? 'Generating…' : 'Generate Repair Options'}
      </button>

      {query.error && (
        <ErrorBox error={query.error} />
      )}

      {model?.empty && (
        <p className="text-xs text-muted-foreground text-center py-3">{model.empty.message}</p>
      )}

      {model && model.options.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {model.options.map(option => (
            <RepairOptionCard key={`${option.regionId}-${option.strategy}`} option={option} />
          ))}
        </div>
      )}
    </div>
  )
}

/** One repair option card — renders the builder view verbatim (C3). */
function RepairOptionCard({ option }: { option: RepairOptionCardView }) {
  const improved = option.improvement > 0
  return (
    <article
      data-testid="repair-option"
      className="w-full p-2.5 rounded-lg border border-border bg-card/50"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-bold text-foreground">#{option.regionId}</span>
        <span className="text-xs font-semibold text-foreground">{option.strategy}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {option.status}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className={`font-mono font-semibold tabular-nums ${improved ? 'text-chart-3' : 'text-destructive'}`}>
          {option.improvementLabel}
        </span>
        {option.metricsBefore && option.metricsAfter && (
          <span className="flex items-center gap-2 font-mono text-muted-foreground">
            <span>
              {option.metricsBefore.manipulability} → {option.metricsAfter.manipulability}
            </span>
            <span>
              {option.metricsBefore.smoothness} → {option.metricsAfter.smoothness}
            </span>
          </span>
        )}
      </div>
    </article>
  )
}
