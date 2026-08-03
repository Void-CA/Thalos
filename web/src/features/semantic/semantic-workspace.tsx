import { TaskEditor } from './components/task-editor'
import { RobotSelector } from './components/robot-selector'
import { PipelineStatus } from './components/pipeline-status'
import { DiagnosticsPanel } from './components/diagnostics-panel'

/**
 * SemanticWorkspace — Programación area (single responsibility: authoring).
 *
 * Structure (frontend-task-workspace spec + area-scene S2): the workspace is
 * a pure authoring environment — Task consumes the Scene ARTIFACT (via
 * `sceneValid` from WorkflowState and `useDomainSceneStore.toTaskDocument`)
 * but renders ZERO Scene editing UI: the Scene editor lives exclusively in
 * the Escena area (`features/scene/SceneWorkspace`).
 *
 *   Task header (robot selector + workflow progress)
 *   ├─ Program     — operations editor + compile + Send to Execution (TaskEditor)
 *   └─ Diagnostics — compile status / validation errors (DiagnosticsPanel)
 *
 * ZERO execution capabilities live here: no Simulate/Stop, no progress, no
 * tick loop. Execution owns the lifecycle (execution-workspace spec).
 */
export function SemanticWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Task header: robot selection + workflow progress ── */}
      <div className="px-3 py-2 border-b border-border/50 space-y-1.5">
        <RobotSelector />
        <PipelineStatus />
      </div>

      {/* ── Program panel (operations + compile + send) ── */}
      <div className="flex-1 overflow-hidden min-h-0">
        <TaskEditor />
      </div>

      {/* ── Diagnostics panel (compile status) ── */}
      <DiagnosticsPanel />
    </div>
  )
}
