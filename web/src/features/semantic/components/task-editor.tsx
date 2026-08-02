import { Play, Plus, RotateCcw, Send } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSemanticEditor } from '../store'
import { useSceneStore } from '../scene-store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import { hasMissingFields } from '@/shared/workflow/derive'
import { OperationRow } from './operation-row'
import { compileSemantic, executeSemantic, CompileError } from '../api'
import { isApiError } from '@/shared/errors'

/** Friendly guided CTAs keyed on the backend machine-readable error code
 *  (verbatim codes from `backend/crates/thalos-api/src/features/semantic/handler.rs`).
 *  The HTTP status is complementary only — decisions key on `code`. */
const CTA_BY_CODE: Record<string, string> = {
  semantic_validation_error: 'Fix the program errors',
  lowering_error: 'Define the referenced objects/locations in Scene',
  planning_error: 'Planning failed — check the robot and scene targets',
  dof_mismatch: 'The loaded robot does not match this task\'s degrees of freedom — select a compatible robot',
}

/** `planning_error` is a generic code — the message is the only signal. IK
 *  failure signatures mean an unreachable/incompatible target, which deserves
 *  a reach-specific CTA; everything else falls back to the generic one above. */
const IK_FAILURE_MARKERS = ['IK failed', 'MaxIterations']
const REACH_CTA = 'Targets are out of the robot\'s reach — adjust scene positions or load a larger robot'

function reachCtaForPlanningError(message: string): string | null {
  return IK_FAILURE_MARKERS.some(marker => message.includes(marker)) ? REACH_CTA : null
}

interface CodedError extends Error {
  code?: string
  status?: number
}

/** Map a normalized HTTP error (ApiError / CompileError) to a guided CTA. */
function describeError(err: unknown): string {
  if (err instanceof CompileError || isApiError(err)) {
    const coded = err as CodedError
    if (coded.code === 'planning_error' && coded.message) {
      const reachCta = reachCtaForPlanningError(coded.message)
      if (reachCta) return `${reachCta} — ${coded.message}`
    }
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

/**
 * TaskEditor — the Program panel of the Task workspace (frontend-task-workspace
 * spec, single responsibility).
 *
 * Task is EXCLUSIVELY an authoring environment: edit scene objects, edit
 * program operations, validate, compile. It owns ZERO execution capabilities —
 * no Simulate/Stop, no progress footers, no tick loop. "Send to Execution"
 * hands the compiled plan to the Execution workspace: `POST /semantic/execute`
 * WITHOUT `start()` (the plan is loaded into the runtime, execStatus → ready),
 * then navigates to /execution. The tick loop only ever starts from Execution
 * (execution-workspace spec, Invariant #5 / Tick Loop Ownership).
 */
export function TaskEditor() {
  const {
    operations, result, loading,
    addOperation, removeOperation, moveOperation, updateOperation,
    setResult, setLoading, setError, reset,
  } = useSemanticEditor()
  const toTaskDocument = useSceneStore((s) => s.toTaskDocument)
  const { compiled } = useWorkflowState()
  const navigate = useNavigate()

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

  /** Handoff (Invariant #5): compile + load the plan into the runtime backend
   *  WITHOUT starting it, record the plan on the execution store, then move to
   *  the Execution workspace — the only place that can start the tick loop. */
  const handleSendToExecution = async () => {
    setLoading(true); setError(null)
    try {
      const res = await executeSemantic({ task: toTaskDocument(makeOps()) })
      if (res.status !== 'ok') { setError('Execution handoff failed'); return }
      useExecutionStore.getState().receivePlan({
        instructionCount: result?.metadata.instruction_count ?? res.segment_count,
        durationSecs: res.duration_secs,
        source: 'TaskDocument',
      })
      navigate('/execution')
    } catch (err) {
      setError(describeError(err))
    } finally { setLoading(false) }
  }

  // Single source of truth: hasMissingFields lives in shared/workflow/derive
  // (lifted in slice 2) — Task consumes it, it never keeps a copy.
  const canCompile = operations.length > 0 && !loading && !hasMissingFields(operations)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex-1">Program</h2>
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
        <button onClick={handleSendToExecution} disabled={!compiled}
          title={compiled ? 'Load the compiled plan into Execution' : 'Compile first'}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
          <Send className="size-3" /> Send to Execution
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
    </div>
  )
}
