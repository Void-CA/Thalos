import { Play, Plus, RotateCcw, Send } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSemanticEditor } from '../store'
import { useDomainSceneStore } from '@/features/scene/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useSceneStore } from '@/features/viewport/store'
import { sceneApi } from '@/features/viewport/api/scene-api'
import {
  toSceneData, toRuntimeInfo, toIkResult, toActivePlan, toToolFrame, toExecutionInfo,
} from '@/features/viewport/adapter'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import { useAnalysisStore } from '@/features/analysis/store'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import { hasMissingFields } from '@/shared/workflow/derive'
import { OperationRow } from './operation-row'
import { compileSemantic, executeSemantic } from '../api'
import { describeError } from '@/shared/errors'
import type { TaskDocument } from '@/shared/contracts'
import { serialize } from '../script/serializer'
import { parse } from '../script/parser'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Hotfix (unify-programming): preview a compiled Task program like the Motion
 * tab does — load it into the scene runtime WITHOUT starting it, so the
 * always-mounted viewport draws the trajectory and the Analysis tab populates.
 *
 * The vehicle is `executeSemantic` (`POST /semantic/execute`): the canonical
 * compile + plan path that SCHEDULES the plan into the scene runtime
 * (`schedule_program`), which is what `/plan/analyze` reads the active plan
 * from. `POST /motion/plan` was NOT used: it returns only `compiled_plan` +
 * `runtime_program`, never schedules, so neither `applyScene` (no scene state)
 * nor the analysis endpoint (no active plan) could work. After the plan is
 * scheduled, `getScene()` returns the full state with `active_plan`, and the
 * standard planning-panel adapters project it onto the scene store.
 *
 * Rejections are NON-BLOCKING: callers treat a failure as "compile ok, preview
 * failed" — the plan never starts (the tick loop only runs from Execution).
 */
async function previewTaskPlan(task: TaskDocument): Promise<void> {
  const execute = await executeSemantic({ task })
  if (execute.status !== 'ok') throw new Error('Plan preview failed')
  const scene = await sceneApi.getScene()
  useSceneStore.getState().applyScene(
    toSceneData(scene.scene),
    toRuntimeInfo(scene),
    toIkResult(scene.ik_result),
    toActivePlan(scene.active_plan),
    toToolFrame(scene.active_tcp),
    toExecutionInfo(scene.execution),
  )
  const analysis = await planAnalysisApi.analyze()
  useAnalysisStore.getState().setAnalysis(analysis)
}

/**
 * TaskEditor — the Program panel of the Task workspace (frontend-task-workspace
 * spec, single responsibility).
 *
 * Task is EXCLUSIVELY an authoring environment: edit scene objects, edit
 * program operations, validate, compile. It owns ZERO execution capabilities —
 * no Simulate/Stop, no progress footers, no tick loop. A single header action
 * (program-dual-editor spec "Unified Compile/Send Button") derives label +
 * handler from `compiled`: "Compile" (green, `compileSemantic`) until a plan is
 * compiled, then "Send to Execution" (purple, `executeSemantic`) with the SAME
 * payload — the memoized `taskDocument` (`{ task: toTaskDocument(ops) }`).
 * "Send to Execution" hands
 * the compiled plan to the Execution workspace: `POST /semantic/execute`
 * WITHOUT `start()` (the plan is loaded into the runtime, execStatus → ready),
 * then navigates to /execution. The tick loop only ever starts from Execution
 * (execution-workspace spec, Invariant #5 / Tick Loop Ownership).
 *
 * Hotfix (unify-programming): Compile ALSO previews the plan — see
 * `previewTaskPlan` — drawing the Task trajectory in the viewport and
 * populating the Analysis tab, non-blocking on preview failure.
 */
export function TaskEditor() {
  const {
    operations, result, loading, scriptErrors,
    addOperation, removeOperation, moveOperation, updateOperation,
    replaceOperations, setScriptErrors,
    setResult, setLoading, setError, reset,
  } = useSemanticEditor()
  const toTaskDocument = useDomainSceneStore((s) => s.toTaskDocument)
  const { compiled } = useWorkflowState()
  const navigate = useNavigate()

  /** S1 dual mode (frontend-task-workspace spec): 'visual' is the default;
   *  toggling only changes the projection, never the store. */
  const [mode, setMode] = useState<'visual' | 'text'>('visual')

  /**
   * S2 text buffer (design P4): component-LOCAL state. The store remains the
   * single canonical source of truth — typing updates ONLY this buffer, and
   * the serializer keeps deriving from `operations`, not from the buffer (R3).
   * The buffer is (re)initialized from `serialize(operations)` on every
   * entry into Text mode, so it can never drift from the model on entry.
   */
  const [buffer, setBuffer] = useState<string>(serialize(operations))

  /**
   * S3.3 sync guard: the serialized store text the buffer was last synced to
   * (Text entry or successful Apply). If `serialize(operations)` diverges from
   * this while in Text mode, the program changed OUTSIDE this buffer — show an
   * indicator instead of silently letting a stale Apply overwrite it.
   */
  const bufferBaseRef = useRef<string>(serialize(operations))

  /** S3.1/S3.2 dirty-guard confirm dialog (P5): Text→Visual with an
   *  uncommitted buffer asks the user before discarding. */
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  /** Text mode renders EXACTLY serialize(operations) on entry; once editing,
   *  the buffer is the working copy until a successful atomic Apply. */
  const switchToText = () => {
    const text = serialize(operations)
    bufferBaseRef.current = text
    setBuffer(text)
    setMode('text')
    setScriptErrors([])
  }

  const switchToVisual = () => {
    setConfirmDiscardOpen(false)
    setMode('visual')
    setScriptErrors([])
  }

  /**
   * Dirty guard (program-dual-editor spec I6, design P5): switching away from
   * Text only risks losing the buffer when it actually holds uncommitted
   * edits (`buffer !== serialize(operations)`). Visual→Text is always safe —
   * it re-serializes the current ops into the buffer.
   */
  const requestSwitchToVisual = () => {
    if (mode === 'text' && buffer !== serialize(operations)) {
      setConfirmDiscardOpen(true)
      return
    }
    switchToVisual()
  }

  /**
   * Atomic commit (program-dual-editor spec I5, R2):
   * parse(buffer) → OK: ONE `replaceOperations(ops)` (whole-set replace + dirty
   * bump) → ERR: record errors for inline/panel display and touch NOTHING in
   * the program state. No partial writes exist in any path. On success the
   * buffer is re-synced to the canonical projection so a subsequent dirty
   * check sees a clean buffer (P7: text is a canonical representation).
   */
  const handleApply = () => {
    const result = parse(buffer)
    if (result.ops === null) {
      setScriptErrors(result.errors)
      return
    }
    setScriptErrors([])
    replaceOperations(result.ops)
    const canonical = serialize(result.ops)
    setBuffer(canonical)
    bufferBaseRef.current = canonical
  }

  /**
   * Live validation (S3.3): the buffer is parsed on EVERY change so parse
   * errors show inline while typing and Apply stays disabled until the text
   * is valid — a guaranteed-failed commit can never be triggered.
   */
  const handleBufferChange = (value: string) => {
    setBuffer(value)
    const res = parse(value)
    setScriptErrors(res.ops === null ? res.errors : [])
  }

  /** S3.3 sync indicator: store changed externally while the buffer holds
   *  uncommitted text → warn, never overwrite silently. */
  const storeText = serialize(operations)
  const storeChangedExternally = mode === 'text' && storeText !== bufferBaseRef.current
  const showSyncWarning = storeChangedExternally && buffer !== storeText

  /** S3.3: no Apply while the buffer has parse errors. */
  const applyDisabled = scriptErrors.length > 0

  /**
   * The SAME task document for Compile and Send (program-dual-editor spec
   * "Unified Compile/Send Button": the payload MUST remain identical — the
   * document compiled IS the document executed). Rebuilding it per call would
   * regenerate id/created_at and hand Execution a DIFFERENT document identity
   * than the one that was compiled. Recomputed only when the operation set
   * changes — and any operation change bumps `dirty`, which reverts the button
   * to "Compile" anyway, so the memo can never go stale behind a Send.
   */
  const taskDocument = useMemo(
    () =>
      toTaskDocument(
        operations.map((op, i) => ({ ...op, origin: op.origin ?? `op_${i}` })),
      ),
    [operations, toTaskDocument],
  )

  const handleCompile = async () => {
    setLoading(true); setError(null)
    try {
      const res = await compileSemantic({ task: taskDocument })
      setResult(res)
      // Hotfix (unify-programming): a compiled Task must behave like the Motion
      // tab — draw its trajectory in the viewport and populate the Analysis
      // tab. Non-blocking: the compile result is already set, so a failed
      // preview only surfaces the error (requirement: no plan → compile ok).
      try {
        await previewTaskPlan(taskDocument)
      } catch (err) {
        setError(describeError(err))
      }
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
      const res = await executeSemantic({ task: taskDocument })
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
        {mode === 'text' && (
          <button onClick={handleApply} disabled={applyDisabled}
            title={applyDisabled ? 'Fix the parse errors before applying' : 'Apply the script to the program'}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-amber-600/20 text-amber-500 hover:bg-amber-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
            Apply
          </button>
        )}
        <button onClick={() => addOperation({ type: 'pick', object: '' })}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer">
          <Plus className="size-3" /> Add
        </button>
        <button onClick={reset}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer">
          <RotateCcw className="size-3" /> Reset
        </button>
        <button onClick={compiled ? handleSendToExecution : handleCompile} disabled={!canCompile}
          title={compiled ? 'Load the compiled plan into Execution' : 'Compile the program'}
          className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
            compiled
              ? 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
              : 'bg-green-600/20 text-green-500 hover:bg-green-600/30'
          }`}>
          {compiled ? <Send className="size-3" /> : <Play className="size-3" />}
          {compiled ? 'Send to Execution' : 'Compile'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {mode === 'text' ? (
          <div className="flex flex-col gap-2 h-full min-h-0">
            <details open data-testid="script-help" className="shrink-0 rounded-lg border border-border/50 bg-card/30 p-2 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground select-none">
                Task Script grammar
              </summary>
              <div className="mt-1.5 space-y-1 font-mono text-muted-foreground">
                <p>{'pick <object> [tool=<name>]'}</p>
                <p>{'place <object> at <location> [tool=<name>]'}</p>
                <p>{'move_to <location> [tool=<name>]'}</p>
                <p>{'wait <duration> — e.g. 500ms, 2s, 1.5s'}</p>
                <p>home</p>
                <p className="font-sans"># comments and blank lines are ignored.</p>
              </div>
              <p className="mt-1.5 font-sans text-muted-foreground">Example:</p>
              <pre className="mt-0.5 font-mono text-muted-foreground">{'pick bolt-1\nwait 2s\nplace bolt-1 at tray-1\nhome'}</pre>
              <p className="mt-1.5 font-sans text-muted-foreground">
                The script is a canonical representation of the program — comments,
                blank lines, and formatting are not preserved.
              </p>
            </details>
            <textarea
              data-testid="program-textarea"
              value={buffer}
              onChange={(e) => handleBufferChange(e.target.value)}
              spellCheck={false}
              aria-label="Task script"
              className="flex-1 min-h-32 w-full resize-none rounded-lg border border-border/50 bg-card/30 p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:border-primary/50"
            />
            {showSyncWarning && (
              <p role="alert" className="text-xs text-amber-400">
                The program changed outside the editor — your uncommitted text is kept, but Apply will replace the external change.
              </p>
            )}
            {scriptErrors.length > 0 && (
              <ul className="space-y-1 text-xs" aria-label="Script parse errors">
                {scriptErrors.map((e, i) => (
                  <li key={i} role="alert" className="text-red-400">
                    line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : operations.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No operations defined.</p>
        ) : (
          operations.map((op, i) => (
            <OperationRow key={i} op={op} index={i} total={operations.length}
              onChange={(idx, p) => updateOperation(idx, p)}
              onRemove={(idx) => removeOperation(idx)}
              onMoveUp={(idx) => idx > 0 && moveOperation(idx, idx - 1)}
              onMoveDown={(idx) => idx < operations.length - 1 && moveOperation(idx, idx + 1)} />
          ))
        )}
      </div>

        
      {/* S3.1/S3.2 dirty guard (P5): the store is NOT touched until the user
       *  confirms — discard only discards the uncommitted buffer. */}
      <Dialog open={confirmDiscardOpen} onOpenChange={(open) => { if (!open) setConfirmDiscardOpen(false) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Uncommitted changes will be lost</DialogTitle>
            <DialogDescription>
              Your text edits have not been applied to the program. Switch to Visual and discard them?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDiscardOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={switchToVisual}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
