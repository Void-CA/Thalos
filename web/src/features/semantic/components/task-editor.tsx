import { Play, Plus, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useSemanticEditor } from '../store'
import { useSceneStore } from '../scene-store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { OperationRow } from './operation-row'
import { compileSemantic, executeSemantic, CompileError } from '../api'
import { isApiError } from '@/shared/errors'

/** Friendly guided CTAs keyed on the backend machine-readable error code
 *  (verbatim codes from `backend/crates/thalos-api/src/features/semantic/handler.rs`).
 *  The HTTP status is complementary only — decisions key on `code`. */
const CTA_BY_CODE: Record<string, string> = {
  semantic_validation_error: 'Fix the program errors',
  lowering_error: 'Define the referenced objects/locations in Scene',
  planning_error: 'Load a robot before executing',
}

interface CodedError extends Error {
  code?: string
  status?: number
}

/** Map a normalized HTTP error (ApiError / CompileError) to a guided CTA. */
function describeError(err: unknown): string {
  if (err instanceof CompileError || isApiError(err)) {
    const coded = err as CodedError
    if (coded.code && CTA_BY_CODE[coded.code]) {
      return `${CTA_BY_CODE[coded.code]} — ${coded.message}`
    }
    if (coded.code) {
      return coded.status != null
        ? `${coded.message} (${coded.code}, HTTP ${coded.status})`
        : `${coded.message} (${coded.code})`
    }
    return coded.message
  }
  return err instanceof Error ? err.message : 'Operation failed'
}

export function TaskEditor() {
  const {
    operations, result, loading, error,
    addOperation, removeOperation, moveOperation, updateOperation,
    setResult, setLoading, setError, reset,
  } = useSemanticEditor()
  const toTaskDocument = useSceneStore((s) => s.toTaskDocument)

  const execStatus = useExecutionStore(s => s.status)
  const execProgress = useExecutionStore(s => s.progress)

  const makeOps = () => operations.map((op, i) => ({ ...op, origin: op.origin ?? `op_${i}` }))

  const handleCompile = async () => {
    setLoading(true); setError(null)
    try {
      const res = await compileSemantic({ task: toTaskDocument(makeOps()) })
      setResult(res)
    } catch (err) {
      setError(describeError(err))
    } finally { setLoading(false) }
  }

  const handleSimulate = async () => {
    setLoading(true); setError(null)
    try {
      // 1. Compile semantic task → backend returns waypoints + schedules into runtime
      const result = await executeSemantic({ task: toTaskDocument(makeOps()) })
      if (result.status !== 'ok') { setError('Execution failed'); return }

      // 2. Start execution — ExecutionStore handles tick loop + applyRuntimeDelta
      await useExecutionStore.getState().start()
    } catch (err) {
      setError(describeError(err))
    } finally { setLoading(false) }
  }

  const handleStop = () => {
    useExecutionStore.getState().cancel()
  }

  const hasMissingFields = operations.some(
    op => (op.type === 'pick' && !op.object) ||
          (op.type === 'place' && (!op.object || !op.destination)) ||
          (op.type === 'move_to' && !op.destination) ||
          (op.type === 'wait' && (!op.duration || (op.duration.secs === 0 && op.duration.nanos === 0))),
  )
  const canCompile = operations.length > 0 && !loading && !hasMissingFields

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex-1">Task Program</h2>
        <button onClick={() => addOperation({ type: 'pick', object: '' })}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer">
          <Plus className="size-3" /> Add
        </button>
        <button onClick={reset}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer">
          <RotateCcw className="size-3" /> Reset
        </button>
        <button onClick={handleCompile} disabled={!canCompile}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-green-600/20 text-green-500 hover:bg-green-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
          <Play className="size-3" /> Compile
        </button>
        <button onClick={handleSimulate} disabled={!result || loading || execStatus === 'running'}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
          <Sparkles className="size-3" /> {execStatus === 'running' ? '▶ Running' : 'Simulate'}
        </button>
        <button onClick={handleStop} disabled={execStatus !== 'running'}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-red-400 hover:bg-red-950/20 disabled:opacity-30 cursor-pointer">
          <Square className="size-3" /> Stop
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {operations.length === 0
          ? <p className="text-xs text-muted-foreground text-center py-8">No operations defined.</p>
          : operations.map((op, i) => (
            <OperationRow key={i} op={op} index={i} total={operations.length}
              onChange={(idx, p) => updateOperation(idx, p)}
              onRemove={(idx) => removeOperation(idx)}
              onMoveUp={(idx) => idx > 0 && moveOperation(idx, idx - 1)}
              onMoveDown={(idx) => idx < operations.length - 1 && moveOperation(idx, idx + 1)} />
          ))
        }
      </div>

      {loading && <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/50">Processing...</div>}
      {error && <div className="px-3 py-2 text-xs text-red-400 bg-red-950/20 border-t border-red-900/30">{error}</div>}

      {execStatus === 'running' && (
        <div className="px-3 py-2 border-t border-border/50 bg-card/20">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-purple-400 font-medium animate-pulse">▶ Executing</span>
            <span className="text-muted-foreground">{(execProgress * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {execStatus === 'completed' && (
        <div className="px-3 py-2 border-t border-border/50 bg-card/20">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-500 font-medium">✓ Completed</span>
            <span className="text-muted-foreground">{useExecutionStore.getState().elapsedSecs.toFixed(1)}s</span>
          </div>
        </div>
      )}

      {result && execStatus !== 'running' && execStatus !== 'completed' && (
        <div className="px-3 py-2 border-t border-border/50 space-y-1.5 bg-card/20">
          <span className="text-green-500 font-medium text-xs">✓ Compiled</span>
          <span className="text-muted-foreground text-xs ml-2">{result.metadata.instruction_count} instructions</span>
          {result.validation.warnings.length > 0 && (
            <div className="text-xs text-amber-400">{result.validation.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
          )}
        </div>
      )}
    </div>
  )
}
