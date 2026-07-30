import { Package } from 'lucide-react'
import { TaskEditor } from './components/task-editor'
import { SceneEditor } from './components/scene-editor'

/**
 * SemanticWorkspace — contenedor del workspace Task.
 *
 * Split vertical: Scene resources (top) + Task Editor (center).
 * El TaskEditor maneja su propia compilación y playback.
 */
export function SemanticWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Scene resources (collapsible) ── */}
      <details className="border-b border-border/50 group" open>
        <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer
                           hover:bg-accent/20 text-xs font-medium text-foreground
                           [&::-webkit-details-marker]:hidden select-none">
          <Package className="size-3.5 text-muted-foreground" />
          <span>Scene</span>
          <span className="text-[10px] text-muted-foreground ml-auto">click to toggle</span>
        </summary>
        <div className="max-h-48 overflow-y-auto border-t border-border/30">
          <SceneEditor />
        </div>
      </details>

      {/* ── Task Editor (incluye toolbar, operaciones, resultado y playback) ── */}
      <div className="flex-1 overflow-hidden">
        <TaskEditor />
      </div>
    </div>
  )
}
