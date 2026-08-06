import { useSemanticEditor } from '../store'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import { CompiledInstructions } from './compiled-instructions'
import { ErrorBox } from '@/components/ui/error-box'

/**
 * DiagnosticsPanel — compile status of the Task workspace
 * (frontend-task-workspace spec, C2: Task = Scene / Program / Diagnostics).
 *
 * Displays the compile result (instruction count, warnings), validation
 * errors and in-flight state, all read from the semantic editor store. It is
 * a pure read-only view: authoring/compile actions live in the Program panel.
 */
export function DiagnosticsPanel() {
  const result = useSemanticEditor((s) => s.result)
  const error = useSemanticEditor((s) => s.error)
  const loading = useSemanticEditor((s) => s.loading)
  const dirty = useSemanticEditor((s) => s.dirty)
  const scriptErrors = useSemanticEditor((s) => s.scriptErrors)
  const { compiled } = useWorkflowState()

  return (
    <section className="border-t border-border/50 bg-card/20 shrink-0" aria-label="Diagnostics">
      <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider px-3 py-1.5">
        Diagnostics
      </h2>
      <div className="px-3 pb-2 space-y-1 text-xs">
        {loading && <p className="text-muted-foreground">Processing...</p>}
        {error && <ErrorBox error={error} />}
        {scriptErrors.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-red-400 font-medium">Script errors</p>
            {scriptErrors.map((e, i) => (
              <p key={i} className="text-red-400">
                line {e.line}: {e.message}
              </p>
            ))}
          </div>
        )}
        {compiled && result && (
          <div className="space-y-0.5">
            <p className="text-green-500 font-medium">✓ Compiled</p>
            <p className="text-muted-foreground">{result.metadata.instruction_count} instructions</p>
            <CompiledInstructions instructions={result.motion_program.instructions} />
            {result.validation.warnings.length > 0 && (
              <div className="text-amber-400">
                {result.validation.warnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            )}
          </div>
        )}
        {result && !compiled && dirty > 0 && (
          <p className="text-amber-400">Program changed — recompile before sending.</p>
        )}
        {!result && !loading && !error && (
          <p className="text-muted-foreground">No compile result — define the program and compile.</p>
        )}
      </div>
    </section>
  )
}
