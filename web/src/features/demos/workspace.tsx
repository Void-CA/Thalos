import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Rocket } from 'lucide-react'
import { useSemanticEditor } from '@/features/semantic/store'
import { isSceneFile, useDomainSceneStore } from '@/features/scene/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { executeSemantic } from '@/features/semantic/api'
import { previewTaskPlan } from '@/features/semantic/run-flow'
import { describeError } from '@/shared/errors'
import type { DemoCatalogEntry } from '@/shared/contracts'
import { listDemos, getDemoScene, getDemoProgram } from './api'

/**
 * DemosWorkspace — the /demos TOOL (demos-workspace spec; D5 kind:'tool', NOT
 * a pipeline stage; D13 Load Demo ≠ Run).
 *
 * The catalog (GET /api/v1/demos) is listed with a [Load Demo] per demo.
 * [Load Demo] fetches the demo's scene + program and hydrates the two domain
 * stores via `loadSceneFile` + `loadProgramText` — hydrate ONLY, no execution.
 * The composition is DELIBERATE: each store action replaces its own domain
 * only (loading a scene never implies a program and vice versa — the
 * demos-workspace state invariants, verified in the Slice 3 store tests).
 * [Run] then triggers the EXISTING pipeline (the exact path the Task editor's
 * Run uses): execute → read-back → navigate to /execution.
 *
 * Error states: catalog fetch failure, demo 404, invalid scene JSON — the
 * message is shown in an alert and the stores stay unchanged.
 */
export function DemosWorkspace() {
  const [catalog, setCatalog] = useState<DemoCatalogEntry[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingDemoId, setLoadingDemoId] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [runLoading, setRunLoading] = useState(false)

  const operations = useSemanticEditor((s) => s.operations)
  const loadProgramText = useSemanticEditor((s) => s.loadProgramText)
  const loadSceneFile = useDomainSceneStore((s) => s.loadSceneFile)
  const toTaskDocument = useDomainSceneStore((s) => s.toTaskDocument)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    listDemos()
      .then((demos) => {
        if (!cancelled) setCatalog(demos)
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(describeError(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** D13 — hydrate ONLY: fetch scene + program and load them into their
   *  stores. Never executes. Any fetch/parse failure shows the message and
   *  leaves the stores unchanged (invalid scene JSON throws BEFORE hydration;
   *  a program parse failure writes nothing — R2 store atomicity). */
  const handleLoadDemo = async (demo: DemoCatalogEntry) => {
    setLoadError(null)
    setLoadingDemoId(demo.id)
    try {
      const [scene, program] = await Promise.all([
        getDemoScene(demo.id),
        getDemoProgram(demo.id),
      ])
      if (!isSceneFile(scene)) {
        setLoadError(`Demo '${demo.id}' returned an invalid scene file — state unchanged`)
        return
      }
      loadSceneFile(scene)
      const errors = loadProgramText(program)
      if (errors.length > 0) {
        setLoadError(
          `Program parse failed: ${errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`,
        )
      }
    } catch (err) {
      setLoadError(describeError(err))
    } finally {
      setLoadingDemoId(null)
    }
  }

  /** D13 — [Run]: the EXISTING pipeline, same as the Task editor Run
   *  (demos-workspace spec "Run executes via existing pipeline"): POST
   *  /semantic/execute → receivePlan → read-back (getScene/analyze, advisory)
   *  → navigate to /execution. No new execution path. */
  const handleRun = async () => {
    setRunLoading(true)
    setRunError(null)
    try {
      const task = toTaskDocument(
        operations.map((op, i) => ({ ...op, origin: op.origin ?? `op_${i}` })),
      )
      const res = await executeSemantic({ task })
      if (res.status !== 'ok') {
        setRunError('Run failed')
        return
      }
      useExecutionStore.getState().receivePlan({
        instructionCount: res.segment_count,
        durationSecs: res.duration_secs,
        source: 'TaskDocument',
      })
      try {
        await previewTaskPlan(task, res)
      } catch {
        // Read-back is advisory — the plan is already scheduled, so Run
        // still navigates to Execution.
      }
      navigate('/execution')
    } catch (err) {
      setRunError(describeError(err))
    } finally {
      setRunLoading(false)
    }
  }

  const canRun = operations.length > 0 && !runLoading

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Demos
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {runError && (
            <p role="alert" className="text-xs text-red-400 truncate" title={runError}>
              {runError}
            </p>
          )}
          <button
            onClick={handleRun}
            disabled={!canRun}
            title={canRun ? 'Run the loaded program through the existing pipeline' : 'Load a demo first'}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-sky-600/20 text-sky-400 hover:bg-sky-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <Rocket className="size-3" /> Run
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {catalogError && (
          <p role="alert" className="text-xs text-red-400">
            Failed to load the demo catalog: {catalogError}
          </p>
        )}
        {!catalogError && catalog.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No demos available.</p>
        )}
        {catalog.map((demo) => (
          <section
            key={demo.id}
            className="rounded-md border border-border px-3 py-2.5 flex items-start justify-between gap-3"
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground">{demo.title}</h3>
              <p className="text-xs text-muted-foreground">{demo.category}</p>
              {demo.narrative && (
                <p className="text-xs text-muted-foreground/70 mt-1">{demo.narrative}</p>
              )}
            </div>
            <button
              onClick={() => void handleLoadDemo(demo)}
              disabled={loadingDemoId !== null}
              aria-label={`Load demo ${demo.title}`}
              title="Load the demo scene + program (does NOT run it)"
              className="shrink-0 inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              {loadingDemoId === demo.id ? 'Loading…' : 'Load Demo'}
            </button>
          </section>
        ))}
        {loadError && (
          <p role="alert" className="text-xs text-red-400">
            {loadError}
          </p>
        )}
      </div>
    </div>
  )
}
