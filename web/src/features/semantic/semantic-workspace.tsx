import { Package } from 'lucide-react'
import { TaskEditor } from './components/task-editor'
import { SceneEditor } from '@/features/scene/components/scene-editor'
import { RobotSelector } from './components/robot-selector'
import { PipelineStatus } from './components/pipeline-status'
import { DiagnosticsPanel } from './components/diagnostics-panel'

/**
 * SemanticWorkspace — Task workspace (single responsibility: authoring).
 *
 * Structure aligned with TaskDocument { scene, program } (frontend-task-workspace
 * spec, C2 — a new user can guess Task "defines the work, nothing more"):
 *
 *   Task header (robot selector + workflow progress)
 *   ├─ Scene       — objects / locations / tools / home (SceneEditor)
 *   ├─ Program     — operations editor + compile + Send to Execution (TaskEditor)
 *   └─ Diagnostics — compile status / validation errors (DiagnosticsPanel)
 *
 * ZERO execution capabilities live here: no Simulate/Stop, no progress, no
 * tick loop. Execution owns the lifecycle (execution-workspace spec).
 *
 * NOTE (S2 transitional): the Scene panel still renders here while the Escena
 * area lands (features/scene/SceneWorkspace is the exclusive owner going
 * forward — this inline block is removed once Task consumes the Scene purely
 * as an artifact). The editor now imports from the new Scene feature.
 */
export function SemanticWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Task header: robot selection + workflow progress ── */}
      <div className="px-3 py-2 border-b border-border/50 space-y-1.5">
        <RobotSelector />
        <PipelineStatus />
      </div>

      {/* ── Scene panel (collapsible) ── */}
      <details className="border-b border-border/50 group" open>
        <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer
                           hover:bg-accent/20 text-xs font-medium text-foreground
                           [&::-webkit-details-marker]:hidden select-none">
          <Package className="size-3.5 text-muted-foreground" />
          <span>Scene</span>
          <span className="text-[10px] text-muted-foreground ml-auto">objects · locations · tools · home</span>
        </summary>
        <div className="max-h-44 overflow-y-auto border-t border-border/30">
          <SceneEditor />
        </div>
      </details>

      {/* ── Program panel (operations + compile + send) ── */}
      <div className="flex-1 overflow-hidden min-h-0">
        <TaskEditor />
      </div>

      {/* ── Diagnostics panel (compile status) ── */}
      <DiagnosticsPanel />
    </div>
  )
}
