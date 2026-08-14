import { Play, Plus, RotateCcw, Send, Upload, Download, Rocket } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import { useSemanticEditor } from '../store'
import { previewTaskPlan } from '../run-flow'
import { useDomainSceneStore } from '@/features/scene/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import { hasMissingFields } from '@/shared/workflow/derive'
import { OperationRow } from './operation-row'
import { compileSemantic, executeSemantic } from '../api'
import { describeError } from '@/shared/errors'
import { downloadTextFile } from '@/shared/download'
import { serialize } from '../script/serializer'
import { parse } from '../script/parser'

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
/** TaskEditor props (hotfix unify-programming): the workspace mounts TWO
 *  instances — the Task tab in the default 'visual' mode and the Code tab
 *  forced into 'text' via `initialMode`. The mode is chosen ONCE at mount;
 *  the tab layout owns switching (each instance keeps its own local buffer,
 *  and only the active tab mounts). */
export interface TaskEditorProps {
  /** Entry mode for this instance. Defaults to 'visual'. */
  initialMode?: 'visual' | 'text'
}

export function TaskEditor({ initialMode = 'visual' }: TaskEditorProps) {
  const {
    operations, result, loading, scriptErrors,
    addOperation, removeOperation, moveOperation, updateOperation,
    replaceOperations, setScriptErrors, loadProgramText,
    setResult, setLoading, setError, reset,
  } = useSemanticEditor()
  const toTaskDocument = useDomainSceneStore((s) => s.toTaskDocument)
  const { compiled } = useWorkflowState()
  const navigate = useNavigate()

  /** S1 dual mode (frontend-task-workspace spec): 'visual' is the default;
   *  the workspace picks the entry mode per tab (initialMode); switching only
   *  changes the projection, never the store. */
  /** The editor mode is FIXED per tab via `initialMode` (the Code tab mounts
   *  <TaskEditor initialMode="text" />) — there is no runtime toggle anymore.
   *  A plain const keeps the render branching (`mode === 'text'`) working
   *  without a state setter that nothing invokes. */
  const mode = initialMode ?? 'visual'

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

  /** Text mode renders EXACTLY serialize(operations) on entry; once editing,
   *  the buffer is the working copy until a successful atomic Apply.
   *
   *  NOTE (hotfix): the mode is fixed per tab via `initialMode` (the Code tab
   *  mounts <TaskEditor initialMode="text" />). There is no runtime
   *  visual↔text toggle anymore, so the old `switchToText`/dirty-guard path
   *  was removed — leaving the tab discards the uncommitted buffer by design
   *  (the store stays the canonical source; the buffer re-serializes on entry).
   */

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

  /** D12 file IO: [Load Program] reads a `.thalos` file and atomically replaces
   *  the operation set (a failed parse writes NOTHING — R2). [Save Program]
   *  downloads the canonical text (spec "Save persists text"). */
  const programInputRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const handleProgramFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const errors = loadProgramText(text)
    setScriptErrors(errors)
    setLoadError(
      errors.length > 0
        ? errors.map((er) => `line ${er.line}: ${er.message}`).join('; ')
        : null,
    )
    e.target.value = ''
  }

  const handleSaveProgram = () => {
    downloadTextFile('program.thalos', serialize(operations), 'text/plain')
  }

  /** D13 [Run]: the existing pipeline — POST /semantic/execute (compile +
   *  schedule) → GET /scene (read back) → POST /plan/analyze (analysis) →
   *  navigate to /execution. No new execution path; the preview read-back is
   *  non-blocking (the Execution workspace re-fetches the scene on mount). */
  const handleRun = async () => {
    setLoading(true); setError(null)
    try {
      const res = await executeSemantic({ task: taskDocument })
      if (res.status !== 'ok') { setError('Run failed'); return }
      useExecutionStore.getState().receivePlan({
        instructionCount: result?.metadata.instruction_count ?? res.segment_count,
        durationSecs: res.duration_secs,
        source: 'TaskDocument',
      })
      try {
        await previewTaskPlan(taskDocument, res)
      } catch {
        // Preview (getScene/analyze) is advisory — the plan is already
        // scheduled, so Run still navigates to Execution.
      }
      navigate('/execution')
    } catch (err) {
      setError(describeError(err))
    } finally { setLoading(false) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Command toolbar (ui-workspace-density R6-R10): three visually
          separated groups — Program (authoring) | File I/O (persistence) |
          Execution (primary actions) — divided by vertical separators. The
          weight hierarchy is encoded in `data-weight` (normal / secondary /
          primary) so the hierarchy survives styling refactors; handlers,
          disabled logic and the unified Compile/Send dual state are
          byte-identical (R11). `data-layer="commands"` marks the commands
          layer of the three-layer workspace (R6). */}
      <div data-layer="commands" className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        {/* Program group */}
        <div data-group="program" className="flex items-center gap-1.5">
          {mode === 'text' && (
            <button onClick={handleApply} disabled={applyDisabled}
              title={applyDisabled ? 'Fix the parse errors before applying' : 'Apply the script to the program'}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-amber-600/20 text-amber-500 hover:bg-amber-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
              Apply
            </button>
          )}
          <button onClick={() => addOperation({ type: 'pick', object: '' })}
            data-weight="normal"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer">
            <Plus className="size-3" /> Add
          </button>
          <button onClick={reset}
            data-weight="secondary"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-destructive hover:bg-accent cursor-pointer">
            <RotateCcw className="size-3" /> Reset
          </button>
        </div>

        {/* Group separator */}
        <div role="separator" aria-orientation="vertical" className="h-4 w-px bg-border/50" />

        {/* File I/O group — visually separated from Program/Execution (R10). */}
        <div data-group="file-io" className="flex items-center gap-1.5">
          <button onClick={() => programInputRef.current?.click()}
            data-weight="secondary"
            title="Load a .thalos program file (replaces the current program)"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer">
            <Upload className="size-3" /> Load Program
          </button>
          <button onClick={handleSaveProgram}
            data-weight="secondary"
            title="Download the program as canonical .thalos text"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer">
            <Download className="size-3" /> Save Program
          </button>
        </div>

        {/* Group separator */}
        <div role="separator" aria-orientation="vertical" className="h-4 w-px bg-border/50" />

        {/* Execution group — both actions primary (R9); the unified button
            keeps its EXACT dual state: green "Compile" until compiled, then
            purple "Send to Execution" with the same memoized payload. */}
        <div data-group="execution" className="flex items-center gap-1.5">
          <button onClick={handleRun} disabled={!canCompile}
            data-weight="primary"
            title="Run the program through the existing pipeline"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-sky-600/20 text-sky-400 hover:bg-sky-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
            <Rocket className="size-3" /> Run
          </button>
          <button onClick={compiled ? handleSendToExecution : handleCompile} disabled={!canCompile}
            data-weight="primary"
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
        <input
          ref={programInputRef}
          type="file"
          accept=".thalos,text/plain"
          aria-label="Load program file"
          onChange={handleProgramFileChange}
          className="hidden"
        />
        {loadError && (
          <p role="alert" className="text-xs text-red-400 truncate" title={loadError}>
            {loadError}
          </p>
        )}
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
    </div>
  )
}
