import { PlanningPanel } from './components/planning-panel'
import { TrajectoryColorPicker } from './components/trajectory-color-picker'
import { AdvisorSection } from './components/AdvisorSection'
import { PlanCharts } from './components/PlanCharts'
import { AlternativesPanel } from '@/features/analysis/components/alternatives-panel'
import { AnalysisSection } from '@/features/analysis/analysis-section'
import { useAnalysisStore } from '@/features/analysis/store'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

/**
 * PlanningWorkspace — layout del workspace Planning.
 *
 * PR2 (workspace-analysis spec, "Planning Workspace Tabs Layout"): the stacked
 * sections became TWO tabs — "Motion Program" (PlanningPanel +
 * TrajectoryColorPicker) and "Analysis" (AdvisorSection + PlanCharts +
 * AlternativesPanel + AnalysisSection). The Analysis tab shows a badge when
 * `report !== null`, and PlanCharts/AlternativesPanel are data-gated: they do
 * NOT render when `report === null` (kills the `no_active_plan` mutation path
 * — alternatives cannot fire against a backend with no active plan).
 *
 * AdvisorSection and AnalysisSection retain their existing null-state
 * behavior (workspace-analysis spec).
 *
 * S4b: the canonical AnalysisReport reaches `<AdvisorSection report={report} />`
 * DIRECTLY from the store (design D3 data flow — useAnalysisStore → AdvisorSection).
 * The Advisor projects the report purely; AnalysisSection keeps the interactive
 * analysis tooling (repair sessions, optimization) until the S4 convergence
 * removes the duplication.
 */
export function PlanningWorkspace() {
  const report = useAnalysisStore(s => s.report)
  return (
    <Tabs defaultValue="motion-program" className="flex flex-col h-full overflow-hidden">
      <TabsList className="mx-3 mt-3 shrink-0">
        <TabsTrigger value="motion-program">Motion Program</TabsTrigger>
        <TabsTrigger value="analysis">
          Analysis
          {report !== null && (
            <span
              data-testid="analysis-tab-badge"
              aria-hidden="true"
              className="inline-flex h-1.5 w-1.5 rounded-full bg-primary-strong shrink-0"
            />
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="motion-program" className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Motion Program */}
        <section>
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            Motion Program
          </h2>
          <PlanningPanel />
        </section>

        {/* Trajectory Color */}
        <section>
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            Trajectory Color
          </h2>
          <TrajectoryColorPicker />
        </section>
      </TabsContent>

      <TabsContent value="analysis" className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Analysis (absorbed from /analysis — one responsibility per workspace) */}
        <section>
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            Analysis
          </h2>
          <AdvisorSection report={report} />
          {report !== null && <PlanCharts report={report} />}
          {report !== null && <AlternativesPanel />}
          <AnalysisSection />
        </section>
      </TabsContent>
    </Tabs>
  )
}
