import { useAnalysisStore, useSelectedRegion } from './store'
import { StatusBanner } from './components/status-banner'
import { ProblemRegions } from './components/problem-regions'
import { RegionInspector } from './components/region-inspector'
import { OptimizationPanel } from './components/optimization-panel'

import { ChartBar } from 'lucide-react'

/**
 * AnalysisSection — analysis UI absorbed into the Planning workspace (slice 6:
 * one responsibility per workspace).
 *
 * Renders inside planning/workspace.tsx as the third section (below Trajectory
 * Color). This is a pure content move: StatusBanner, ProblemRegions,
 * RegionInspector (with repair sessions) and OptimizationPanel behave exactly
 * as before.
 *
 * No cross-navigation: the breadcrumb and the back-to-planning control were
 * removed — the global stepper + top-bar own workspace navigation. The only
 * navigation inside the section is the intra-workspace region drill-down
 * (selectRegion → RegionInspector), which keeps working.
 *
 * When no analysis exists yet, a short empty state explains how to get one
 * (the planning preview flow compiles + analyzes) — deliberately without a
 * link to another workspace, because we are already in the workspace that
 * produces the analyzed flag.
 */
export function AnalysisSection() {
  const report = useAnalysisStore(s => s.report)
  const selectedRegion = useSelectedRegion()
  const hasAnalysis = report !== null

  if (!hasAnalysis) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <ChartBar className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-xs">Compile and preview a motion program to see analysis</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <StatusBanner />
      {selectedRegion ? (
        <RegionInspector />
      ) : (
        <>
          <ProblemRegions />
          <OptimizationPanel />
        </>
      )}
    </div>
  )
}
