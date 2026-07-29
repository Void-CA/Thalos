import { FlaskConical, FileCode } from 'lucide-react'
import { TaskEditor } from './components/task-editor'
import { useSemanticEditor } from './store'

/**
 * SemanticWorkspace — layout del workspace Task.
 *
 * Contenedor fino: toolbar superior, editor en el centro,
 * panel de compilación al pie (cuando hay resultado).
 */
export function SemanticWorkspace() {
  const result = useSemanticEditor((s) => s.result)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-card/10">
        <FileCode className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Task Program</span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {result
            ? `${result.metadata.instruction_count} instr · ${result.execution_plan.segment_count} seg · ${result.execution_plan.duration_ms} ms`
            : '—'}
        </span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <TaskEditor />
      </div>

      {/* Compilation result footer */}
      {result && (
        <div className="border-t border-border/50 bg-card/5">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
            <FlaskConical className="size-3 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              Compilation
            </span>
          </div>
          <div className="px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-4 text-xs">
              <span
                className={
                  result.status === 'ok'
                    ? 'text-green-500 font-medium'
                    : 'text-red-400 font-medium'
                }
              >
                {result.status === 'ok' ? '✓ Compiled' : '✗ Failed'}
              </span>
              <span className="text-muted-foreground">
                {result.metadata.instruction_count} instructions
              </span>
              <span className="text-muted-foreground">
                {result.execution_plan.segment_count} segments
              </span>
              <span className="text-muted-foreground">
                {result.execution_plan.duration_ms} ms
              </span>
              <span className="text-muted-foreground">
                {result.metadata.planning_time_ms} ms (planning)
              </span>
            </div>
            {result.validation.warnings.length > 0 && (
              <div className="text-xs text-amber-400 space-y-0.5">
                {result.validation.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
            {result.validation.errors.length > 0 && (
              <div className="text-xs text-red-400 space-y-0.5">
                {result.validation.errors.map((e, i) => (
                  <div key={i}>✗ {e}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
