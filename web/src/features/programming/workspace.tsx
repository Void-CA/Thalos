import { PipelineStatus } from '@/features/semantic/components/pipeline-status'
import { TaskEditor } from '@/features/semantic/components/task-editor'
import { DiagnosticsPanel } from '@/features/semantic/components/diagnostics-panel'
import { PlanningPanel } from '@/features/planning/components/planning-panel'
import { TrajectoryColorPicker } from '@/features/planning/components/trajectory-color-picker'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

/**
 * ProgrammingWorkspace — the UNIFIED Programación area (/task, stage 3).
 *
 * Hotfix (unify-programming): /task (semantic editor) and /planning (motion
 * program) were the SAME thing — commanding the robot with different
 * syntaxes — so they merge into ONE workspace with two tabs. Each tab is one
 * of the two ways to express an order, making it explicit that they are
 * alternate representations of the same interaction medium:
 *
 *   Programación (workflow progress)
 *   ├─ Tasks   — semantic editor (TaskEditor, internal Visual/Text) +
 *   │            compile status (DiagnosticsPanel)
 *   └─ Motion  — segment-by-segment motion program (PlanningPanel +
 *                TrajectoryColorPicker), built from /scene/preview
 *
 * HOTFIX (evaluation-workspace): the Analysis TAB was REMOVED — the analysis
 * check is now the /evaluation VISTA (pre-execution EVALUACIÓN, stage 4).
 * The evaluation content (regions, recommendations, repair options,
 * optimization) moved there; this workspace keeps ONLY the two plan-authoring
 * tabs. The workspace consumes the Scene ARTIFACT (`sceneValid` via
 * WorkflowState) and renders ZERO Scene editing UI (the Scene editor lives
 * exclusively in Escena, features/scene/SceneWorkspace). It produces the
 * plan: `compiled` (origin of `planReady`) and the MotionPlan artifact handed
 * to /evaluation and /execution.
 */
export function ProgrammingWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Programming header: workflow progress ── */}
      <div className="px-3 py-2 border-b border-border/50">
        <PipelineStatus />
      </div>

      <Tabs defaultValue="tasks" className="flex flex-col h-full overflow-hidden min-h-0">
        <TabsList className="mx-3 mt-3 shrink-0">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="motion">Motion</TabsTrigger>
        </TabsList>

        {/* Tab 1 — semantic editor (Visual/Text) + compile diagnostics. */}
        <TabsContent value="tasks" className="flex-1 overflow-hidden min-h-0 flex flex-col">
          <div className="flex-1 overflow-hidden min-h-0">
            <TaskEditor />
          </div>
          <DiagnosticsPanel />
        </TabsContent>

        {/* Tab 2 — motion program by segments + trajectory color. */}
        <TabsContent value="motion" className="flex-1 overflow-y-auto p-3 space-y-4">
          <PlanningPanel />

          <section>
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
              Trajectory Color
            </h2>
            <TrajectoryColorPicker />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
