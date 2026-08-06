import { EChart, manipulabilityBuilder } from '@/shared/charts'
import { useAnalysisStore } from '@/features/analysis/store'

/**
 * YoshikawaChart — porción 1 del grid de /evaluation (hotfix evaluation-
 * layout): the per-waypoint manipulability (Yoshikawa) chart, rendered from the
 * canonical report via the pure `manipulabilityBuilder` (threshold markLine +
 * dataZoom included). Pure consumer: no domain mapping in the component.
 */
export function YoshikawaChart() {
  const report = useAnalysisStore((s) => s.report)
  if (!report) return null

  return (
    <section className="flex min-w-0 rounded-lg border border-border bg-card px-3 py-2.5">
      <EChart model={manipulabilityBuilder(report)} className="h-80 w-full" />
    </section>
  )
}
