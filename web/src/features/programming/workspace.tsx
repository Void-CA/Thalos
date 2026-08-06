import { PipelineStatus } from '@/features/semantic/components/pipeline-status'
import { TaskEditor } from '@/features/semantic/components/task-editor'
import { DiagnosticsPanel } from '@/features/semantic/components/diagnostics-panel'
import { PlanningPanel } from '@/features/planning/components/planning-panel'
import { TrajectoryColorPicker } from '@/features/planning/components/trajectory-color-picker'
import { AdvisorSection } from '@/features/planning/components/AdvisorSection'
import { PlanCharts } from '@/features/planning/components/PlanCharts'
import { AlternativesPanel } from '@/features/analysis/components/alternatives-panel'
import { AnalysisSection } from '@/features/analysis/analysis-section'
import { useAnalysisStore } from '@/features/analysis/store'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

/**
 * ProgrammingWorkspace — the UNIFIED Programación area (/task, stage 3).
 *
 * Hotfix (unify-programming): /task (semantic editor) and /planning (motion
 * program + analysis) were the SAME thing — commanding the robot with
 * different syntaxes — so they merge into ONE workspace with three tabs. Each
 * tab is one of the three ways to express an order, making it explicit that
 * they are alternate representations of the same interaction medium:
 *
 *   Programación (workflow progress)
 *   ├─ Programa       — semantic editor (TaskEditor, internal Visual/Text) +
 *   │                   compile status (DiagnosticsPanel)
 *   ├─ Motion Program — segment-by-segment motion program (PlanningPanel +
 *   │                   TrajectoryColorPicker), built from /scene/preview
 *   └─ Analysis       — AdvisorSection + PlanCharts + AlternativesPanel +
 *                       AnalysisSection (report-gated: badge when report
 *                       exists; PlanCharts/AlternativesPanel render only when
 *                       `report !== null`)
 *
 * The workspace consumes the Scene ARTIFACT (`sceneValid` via WorkflowState)
 * and renders ZERO Scene editing UI (the Scene editor lives exclusively in
 * Escena, features/scene/SceneWorkspace). It produces the plan: `compiled`
 * (origin of `planReady`) and the MotionPlan artifact handed to /execution.
 * PR2 (workspace-analysis spec "Tabs Layout"): the Analysis tab shows a badge
 * when `report !== null`, and the data-gated components SHALL NOT fire against
 * a backend with no active plan.
 */
export function ProgrammingWorkspace() {
  const report = useAnalysisStore((s) => s.report)
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Programming header: workflow progress ── */}
      <div className="px-3 py-2 border-b border-border/50">
        <PipelineStatus />
      </div>

      <Tabs defaultValue="programa" className="flex flex-col h-full overflow-hidden min-h-0">
        <TabsList className="mx-3 mt-3 shrink-0">
          <TabsTrigger value="programa">Programa</TabsTrigger>
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

        {/* Tab 1 — semantic editor (Visual/Text) + compile diagnostics. */}
        <TabsContent value="programa" className="flex-1 overflow-hidden min-h-0 flex flex-col">
          <div className="flex-1 overflow-hidden min-h-0">
            <TaskEditor />
          </div>
          <DiagnosticsPanel />
        </TabsContent>

        {/* Tab 2 — motion program by segments + trajectory color. */}
        <TabsContent value="motion-program" className="flex-1 overflow-y-auto p-3 space-y-4">
          <section>
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
              Motion Program
            </h2>
            <PlanningPanel />
          </section>

          <section>
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
              Trajectory Color
            </h2>
            <TrajectoryColorPicker />
          </section>
        </TabsContent>

        {/* Tab 3 — analysis (absorbed from /planning; kept in the workspace). */}
        <TabsContent value="analysis" className="flex-1 overflow-y-auto p-3 space-y-4">
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
    </div>
  )
}
