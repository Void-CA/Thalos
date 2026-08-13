import { EChart, manipulabilityBuilder } from '@/shared/charts'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'

/**
 * YoshikawaChart — portion 1 of the /evaluation grid (hotfix evaluation-
 * layout): the per-waypoint manipulability (Yoshikawa) chart, rendered from the
 * canonical report via the pure `manipulabilityBuilder` (threshold markLine +
 * dataZoom included). Pure consumer: no domain mapping in the component.
 */
export function YoshikawaChart() {
  const report = useAnalysisStore((s) => s.report)
  // L_ref for the legacy-payload fallback comes from the loaded scene;
  // absent scene data degrades to 1.0 (the builder's documented no-op).
  const refDim = useSceneStore((s) => s.data?.referenceDimension) ?? 1.0
  if (!report) return null

  return (
    <section className="flex min-w-0 rounded-lg border border-border bg-card px-3 py-2.5">
      <EChart model={manipulabilityBuilder(report, refDim)} className="h-80 w-full" />
    </section>
  )
}
