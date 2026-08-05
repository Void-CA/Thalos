import { Activity, Clock, Play, Square, RefreshCw, Pause, Gauge, ListOrdered } from 'lucide-react'
import { useExecutionStore } from './execution-store'

/**
 * ExecutionWorkspace — the single owner of execution lifecycle and runtime
 * progress (execution-workspace spec, Invariant #5).
 *
 * Structure (user contract C3 — "Execution executes and observes"):
 *   Execution (header + status badge)
 *   ├─ Active Plan        — plan metadata handed off from Task
 *   ├─ Execution Controls — Start/Pause/Resume/Cancel/Reset by execStatus
 *   ├─ Execution Status   — current status + runtime error
 *   ├─ Progress / Elapsed — bar + elapsed time from the tick loop
 *   ├─ Timeline           — placeholder (change 2)
 *   └─ Telemetry          — placeholder (change 2)
 *
 * The tick loop is ONLY started by `start()` from this workspace — Task never
 * starts it (its Send-to-Execution handoff leaves execStatus = 'ready').
 */
export function ExecutionWorkspace() {
  const status = useExecutionStore((s) => s.status)
  const progress = useExecutionStore((s) => s.progress)
  const elapsedSecs = useExecutionStore((s) => s.elapsedSecs)
  const error = useExecutionStore((s) => s.error)
  const activePlan = useExecutionStore((s) => s.activePlan)

  const start = useExecutionStore((s) => s.start)
  const pause = useExecutionStore((s) => s.pause)
  const resume = useExecutionStore((s) => s.resume)
  const cancel = useExecutionStore((s) => s.cancel)
  const reset = useExecutionStore((s) => s.reset)

  // Spec control table — each action enabled exactly for these statuses.
  const canStart = status === 'ready'
  const canPause = status === 'running'
  const canResume = status === 'paused'
  const canCancel = status === 'running' || status === 'paused'
  const canReset = status === 'completed' || status === 'failed'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex-1">Execution</h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide
            ${status === 'running' ? 'bg-green-600/20 text-green-500'
              : status === 'paused' ? 'bg-amber-600/20 text-amber-500'
              : status === 'failed' ? 'bg-red-600/20 text-red-400'
              : status === 'completed' ? 'bg-green-600/20 text-green-500'
              : 'bg-muted text-muted-foreground'}`}
        >
          {status === 'running' && <Activity className="size-2.5 animate-pulse" />}
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* ── Active Plan ── */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
            <ListOrdered className="size-3 text-muted-foreground" /> Active Plan
          </h3>
          {activePlan ? (
            <div className="rounded-lg border border-border/50 bg-card/30 p-2.5 space-y-1 text-xs">
              <div className="text-foreground">{activePlan.instructionCount} instructions</div>
              <div className="text-muted-foreground">Est. {activePlan.durationSecs.toFixed(1)}s</div>
              <div className="text-muted-foreground">Source: {activePlan.source}</div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border/60 p-2.5">
              No plan loaded — send from Task or preview a Motion Program
            </p>
          )}
        </section>

        {/* ── Execution Controls ── */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
            <Play className="size-3 text-muted-foreground" /> Execution Controls
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => void start()} disabled={!canStart}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-600/20 text-green-500 hover:bg-green-600/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
              <Play className="size-3" /> Start
            </button>
            <button onClick={() => void pause()} disabled={!canPause}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
              <Pause className="size-3" /> Pause
            </button>
            <button onClick={() => void resume()} disabled={!canResume}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
              <Play className="size-3" /> Resume
            </button>
            <button onClick={() => void cancel()} disabled={!canCancel}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-red-400 hover:bg-red-950/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
              <Square className="size-3" /> Cancel
            </button>
            <button onClick={() => void reset()} disabled={!canReset}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
              <RefreshCw className="size-3" /> Reset
            </button>
          </div>
        </section>

        {/* ── Execution Status ── */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
            <Gauge className="size-3 text-muted-foreground" /> Execution Status
          </h3>
          <p className="text-xs text-foreground">
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : (
              `Status: ${status}`
            )}
          </p>
        </section>

        {/* ── Progress / Elapsed ── */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
            <Clock className="size-3 text-muted-foreground" /> Progress / Elapsed
          </h3>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-green-600/70 transition-[width] duration-300"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>{(progress * 100).toFixed(0)}%</span>
            <span>{elapsedSecs.toFixed(1)}s elapsed</span>
          </div>
        </section>

        {/* ── Timeline (change 2) ── */}
        <section>
          <h3 className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
            Timeline
          </h3>
          <p className="text-[10px] text-muted-foreground/60 italic">
            Timeline visualization arrives with change 2.
          </p>
        </section>

        {/* ── Telemetry (change 2) ── */}
        <section>
          <h3 className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1">
            Telemetry
          </h3>
          <p className="text-[10px] text-muted-foreground/60 italic">
            Telemetry stream arrives with change 2.
          </p>
        </section>
      </div>
    </div>
  )
}
