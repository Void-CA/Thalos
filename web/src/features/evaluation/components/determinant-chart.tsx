import { EChart, determinantBuilder } from '@/shared/charts'
import { useAnalysisStore } from '@/features/analysis/store'

/**
 * DeterminantChart — porción 2 del grid de /evaluation (hotfix evaluation-
 * layout): the per-waypoint Jacobian determinant det(J·Jᵀ) chart, rendered
 * from the canonical report via the pure `determinantBuilder` (threshold
 * markLine + dataZoom included). Pure consumer: no domain mapping in the
 * component.
 */
export function DeterminantChart() {
  const report = useAnalysisStore((s) => s.report)
  if (!report) return null

  return (
    <section className="flex min-w-0 rounded-lg border border-border bg-card px-3 py-2.5">
      <EChart model={determinantBuilder(report)} className="h-64 w-full" />
    </section>
  )
}
