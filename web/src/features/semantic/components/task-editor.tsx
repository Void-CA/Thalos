import { Play, Plus, RotateCcw } from 'lucide-react'
import { useSemanticEditor } from '../store'
import { useSceneStore } from '../scene-store'
import { OperationRow } from './operation-row'
import { compileSemantic, CompileError } from '../api'

export function TaskEditor() {
  const {
    operations,
    result,
    loading,
    error,
    addOperation,
    removeOperation,
    moveOperation,
    updateOperation,
    setResult,
    setLoading,
    setError,
    reset,
  } = useSemanticEditor()

  const toTaskDocument = useSceneStore((s) => s.toTaskDocument)

  const handleCompile = async () => {
    setLoading(true)
    setError(null)
    try {
      // Add auto-generated origins for each operation
      const ops = operations.map((op, i) => ({ ...op, origin: op.origin ?? `op_${i}` }))
      const task = toTaskDocument(ops)
      const res = await compileSemantic({ task })
      setResult(res)
    } catch (err) {
      if (err instanceof CompileError) {
        setError(err.code ? `[${err.code}] ${err.message}` : err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Compilation failed')
      }
    }
  }

  const hasMissingFields = operations.some(
    (op) =>
      (op.type === 'pick' && !op.object) ||
      (op.type === 'place' && (!op.object || !op.destination)) ||
      (op.type === 'move_to' && !op.destination) ||
      (op.type === 'wait' && (!op.duration_secs || op.duration_secs <= 0)),
  )
  const canCompile = operations.length > 0 && !loading && !hasMissingFields

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex-1">
          Task Program
        </h2>
        <button
          onClick={() =>
            addOperation({ type: 'pick', object: '' })
          }
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md
                     bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
        >
          <Plus className="size-3" />
          Add
        </button>
        <button
          onClick={reset}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
        >
          <RotateCcw className="size-3" />
          Reset
        </button>
        <button
          onClick={handleCompile}
          disabled={!canCompile}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md
                     bg-green-600/20 text-green-500 hover:bg-green-600/30
                     disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Play className="size-3" />
          Compile
        </button>
      </div>

      {/* Operation list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {operations.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            No operations. Define resources in Scene, then click "Add" to
            start building your task.
          </p>
        ) : (
          operations.map((op, i) => (
            <OperationRow
              key={i}
              op={op}
              index={i}
              total={operations.length}
              onChange={(idx, partial) => updateOperation(idx, partial)}
              onRemove={(idx) => removeOperation(idx)}
              onMoveUp={(idx) =>
                idx > 0 && moveOperation(idx, idx - 1)
              }
              onMoveDown={(idx) =>
                idx < operations.length - 1 &&
                moveOperation(idx, idx + 1)
              }
            />
          ))
        )}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/50">
          Compiling...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-950/20 border-t border-red-900/30">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="px-3 py-2 border-t border-border/50 space-y-1.5 bg-card/20">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-green-500 font-medium">
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
              {result.metadata.planning_time_ms} ms planning
            </span>
          </div>
          {result.validation.warnings.length > 0 && (
            <div className="text-xs text-amber-400">
              {result.validation.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
          {result.validation.errors.length > 0 && (
            <div className="text-xs text-red-400">
              {result.validation.errors.map((e, i) => (
                <div key={i}>✗ {e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
