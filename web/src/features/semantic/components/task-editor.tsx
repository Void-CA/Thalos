import { Play, Plus, RotateCcw, Sparkles } from 'lucide-react'
import { useSemanticEditor } from '../store'
import { useSceneStore } from '../scene-store'
import { useSceneStore as useViewportStore } from '@/features/viewport/store'
import { OperationRow } from './operation-row'
import { compileSemantic, executeSemantic, CompileError } from '../api'

let tickTimer: ReturnType<typeof setInterval> | null = null

export function TaskEditor() {
  const {
    operations, result, loading, error,
    addOperation, removeOperation, moveOperation, updateOperation,
    setResult, setLoading, setError, reset,
  } = useSemanticEditor()
  const toTaskDocument = useSceneStore((s) => s.toTaskDocument)

  const makeOps = () => operations.map((op, i) => ({ ...op, origin: op.origin ?? `op_${i}` }))

  const handleCompile = async () => {
    setLoading(true); setError(null)
    try {
      const res = await compileSemantic({ task: toTaskDocument(makeOps()) })
      setResult(res)
    } catch (err) {
      setError(err instanceof CompileError ? err.message : (err instanceof Error ? err.message : 'Failed'))
    } finally { setLoading(false) }
  }

  const handleSimulate = async () => {
    setLoading(true); setError(null)
    try {
      // 1. Compile + plan → load into runtime
      await executeSemantic({ task: toTaskDocument(makeOps()) })
      // 2. Start execution
      await fetch('/api/v1/scene/motion/start', { method: 'POST' })
      // 3. Tick loop (50ms) — like Angular
      if (tickTimer) clearInterval(tickTimer)
      tickTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/v1/scene/motion/tick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dt: 0.05 }),
          })
          if (res.ok) {
            const delta = await res.json()
            useViewportStore.getState().applyRuntimeDelta(delta.joints ?? [], delta.transforms ?? [], {
              status: 'running',
              progress: 0.5,
              elapsedSecs: 0,
            })
          }
        } catch {}
      }, 50)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    } finally { setLoading(false) }
  }

  const handleStop = () => {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
    fetch('/api/v1/scene/motion/cancel', { method: 'POST' }).catch(() => {})
  }

  const hasMissingFields = operations.some(
    op => (op.type === 'pick' && !op.object) ||
          (op.type === 'place' && (!op.object || !op.destination)) ||
          (op.type === 'move_to' && !op.destination) ||
          (op.type === 'wait' && (!op.duration_secs || op.duration_secs <= 0)),
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
        <button onClick={handleSimulate} disabled={!result || loading}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
          <Sparkles className="size-3" /> Simulate
        </button>
        <button onClick={handleStop}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-red-400 hover:bg-red-950/20 cursor-pointer">
          ■ Stop
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {operations.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No operations defined.</p>
        ) : operations.map((op, i) => (
          <OperationRow key={i} op={op} index={i} total={operations.length}
            onChange={(idx, p) => updateOperation(idx, p)}
            onRemove={(idx) => removeOperation(idx)}
            onMoveUp={(idx) => idx > 0 && moveOperation(idx, idx - 1)}
            onMoveDown={(idx) => idx < operations.length - 1 && moveOperation(idx, idx + 1)} />
        ))}
      </div>

      {loading && <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/50">Compiling...</div>}
      {error && <div className="px-3 py-2 text-xs text-red-400 bg-red-950/20 border-t border-red-900/30">{error}</div>}
      {result && (
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
