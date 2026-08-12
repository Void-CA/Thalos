import { useEffect, useState } from 'react'
import { Activity, Clock, Play, Square, RefreshCw, Pause, Gauge, ListOrdered, Repeat, Repeat1, Cpu } from 'lucide-react'
import { useExecutionStore } from './execution-store'
import { useBackendStore } from './backend-store'
import { BackendSelector } from './components/backend-selector'
import { ErrorBox } from '@/components/ui/error-box'
import type { ExecutionModeDto } from '@/features/viewport/api/scene-api.types'

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
  const iteration = useExecutionStore((s) => s.iteration)
  const totalIterations = useExecutionStore((s) => s.totalIterations)
  const source = useExecutionStore((s) => s.source)
  const lastFeedbackAt = useExecutionStore((s) => s.lastFeedbackAt)

  const start = useExecutionStore((s) => s.start)
  const pause = useExecutionStore((s) => s.pause)
  const resume = useExecutionStore((s) => s.resume)
  const cancel = useExecutionStore((s) => s.cancel)
  const reset = useExecutionStore((s) => s.reset)

  // Hardware connection state for the source pill — "ESP32 · Connected".
  const activeBackend = useBackendStore((s) => s.backends.find((b) => b.id === s.activeId))
  const hardwareConnected = activeBackend?.id === 'esp32' && activeBackend.connected === true

  // Feedback-age ticker: re-render ~4x/s while running so the "Feedback X ms
  // ago" line stays live. A connection being open says nothing about whether
  // communication is actually alive — the age distinguishes healthy from
  // stalled without any backend change (lastFeedbackAt comes from the tick).
  const [, setNow] = useState(0)
  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => setNow((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [status])
  const feedbackAgeMs =
    source === 'Hardware' && hardwareConnected && status === 'running' && lastFeedbackAt !== null
      ? Math.max(0, Math.round(performance.now() - lastFeedbackAt))
      : null
  const feedbackHealth: 'healthy' | 'delayed' | 'stale' | null =
    feedbackAgeMs === null
      ? null
      : feedbackAgeMs > 2000
        ? 'stale'
        : feedbackAgeMs > 500
          ? 'delayed'
          : 'healthy'

  // Mode selection (EW1/EW2): Once by default; Repeat(N) with 1..=1000.
  const [modeKind, setModeKind] = useState<'once' | 'repeat'>('once')
  const [repeatCount, setRepeatCount] = useState(5)

  const selectedMode: ExecutionModeDto =
    modeKind === 'once' ? 'once' : { repeat: { count: repeatCount } }

  const handleStart = () => void start(selectedMode)

  // Spec control table — each action enabled exactly for these statuses.
  const canStart = status === 'ready'
  const canPause = status === 'running'
  const canResume = status === 'paused'
  const canCancel = status === 'running' || status === 'paused'
  const canReset = status === 'completed' || status === 'failed'

  // Unified control-button base (visual audit V3): every lifecycle control
  // shares the same shape; only the semantic color varies.
  const controlBtn =
    'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer'

  /** connection_lost / not_connected get the connect CTA (reconnect the
   *  hardware backend + retry); every other failure gets Retry
   *  (reset + start) — execution-workspace spec + R3-001. */
  const isConnectionLost = error?.code === 'connection_lost'
  const isNotConnected = error?.code === 'not_connected'
  const needsConnect = isConnectionLost || isNotConnected

  const handleRetry = () => {
    void reset().then(() => start())
  }

  const handleReconnect = async () => {
    // Reconnect the active hardware backend with its current port first.
    const { backends, activeId, connect } = useBackendStore.getState()
    const active = backends.find((b) => b.id === activeId)
    if (active?.id === 'esp32') {
      await connect(active.id, active.port ?? '')
    }
    await reset()
    await start()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex-1">Execution</h2>
        {/* Session status badge — session readiness, NOT connection state.
            The connection state lives in the Backend section below, so this
            badge never pretends to say anything about the hardware. */}
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
        {/* ── Backend / Connection ── */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
            <Cpu className="size-3 text-muted-foreground" /> Backend
          </h3>
          {/* Connection line — the source of truth for WHERE this execution
              runs. Always visible: Simulation, or ESP32 · Connected/Disconnected. */}
          <div className="mb-2">
            <span
              data-testid="execution-source-pill"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                source === 'Hardware'
                  ? !hardwareConnected
                    ? 'bg-red-600/20 text-red-400'
                    : feedbackHealth === 'stale'
                      ? 'bg-red-600/20 text-red-400'
                      : feedbackHealth === 'delayed'
                        ? 'bg-amber-600/20 text-amber-500'
                        : 'bg-blue-600/20 text-blue-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {source === 'Hardware' ? (
                <>
                  ESP32 · {hardwareConnected ? 'Connected' : 'Disconnected'}
                  {feedbackHealth && (
                    <>
                      {' · '}
                      {feedbackHealth === 'stale'
                        ? 'No recent feedback'
                        : `Feedback ${feedbackAgeMs} ms ago`}
                    </>
                  )}
                </>
              ) : (
                'Simulation'
              )}
            </span>
          </div>
          <BackendSelector />
        </section>

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

          {/* Mode selector (EW1/EW2): only meaningful before a run starts. */}
          {canStart && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/50 bg-card/30 p-2 text-xs">
              <span className="text-muted-foreground">Mode</span>
              <button
                onClick={() => setModeKind('once')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer ${
                  modeKind === 'once'
                    ? 'bg-green-600/20 text-green-500'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                <Repeat1 className="size-3" /> Once
              </button>
              <button
                onClick={() => setModeKind('repeat')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer ${
                  modeKind === 'repeat'
                    ? 'bg-green-600/20 text-green-500'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                <Repeat className="size-3" /> Repeat
              </button>
              {modeKind === 'repeat' && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={repeatCount}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(1000, Number(e.target.value) || 1))
                      setRepeatCount(v)
                    }}
                    className="w-16 rounded border border-border/60 bg-background px-1.5 py-0.5 text-right font-mono text-xs"
                    aria-label="Repeat count"
                  />
                  <span className="text-muted-foreground">times</span>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button onClick={handleStart} disabled={!canStart}
              className={`${controlBtn} bg-green-600/20 text-green-500 hover:bg-green-600/30`}>
              <Play className="size-3" /> Start
            </button>
            <button onClick={() => void pause()} disabled={!canPause}
              className={`${controlBtn} text-foreground hover:bg-accent`}>
              <Pause className="size-3" /> Pause
            </button>
            <button onClick={() => void resume()} disabled={!canResume}
              className={`${controlBtn} text-foreground hover:bg-accent`}>
              <Play className="size-3" /> Resume
            </button>
            <button onClick={() => void cancel()} disabled={!canCancel}
              className={`${controlBtn} text-red-400 hover:bg-red-950/20`}>
              <Square className="size-3" /> Cancel
            </button>
            <button onClick={() => void reset()} disabled={!canReset}
              className={`${controlBtn} text-muted-foreground hover:bg-accent`}>
              <RefreshCw className="size-3" /> Reset
            </button>
          </div>
        </section>

        {/* ── Execution Status ── */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
            <Gauge className="size-3 text-muted-foreground" /> Execution Status
          </h3>
          <div className="flex flex-col items-start gap-2 text-xs text-foreground">
            {error ? (
              <>
                <ErrorBox error={error} />
                {status === 'failed' && (
                  <button
                    onClick={() => {
                      // Resilience-matrix retry: Retry (reset + start) for
                      // network/timeout failures; Reconnect/Connect (reconnect
                      // the active hardware backend, then reset + start) for
                      // connection_lost / not_connected — execution-workspace
                      // spec + R3-001.
                      if (needsConnect) {
                        void handleReconnect()
                      } else {
                        handleRetry()
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-600/20 text-green-500 hover:bg-green-600/30 cursor-pointer"
                  >
                    <RefreshCw className="size-3" /> {isConnectionLost ? 'Reconnect' : isNotConnected ? 'Connect' : 'Retry'}
                  </button>
                )}
              </>
            ) : (
              `Status: ${status}`
            )}
          </div>
        </section>

        {/* ── Progress / Elapsed ── */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground uppercase tracking-wider mb-1.5">
            <Clock className="size-3 text-muted-foreground" /> Progress / Elapsed
          </h3>
          {/* Iteration badge (EW3-EW6): only for Repeat sessions — the backend
              omits total_iterations for Once, so the badge stays hidden. */}
          {totalIterations !== undefined && totalIterations > 1 && (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Iteration</span>
              <span className="font-mono font-semibold text-foreground">
                {status === 'failed'
                  ? `Failed at ${iteration} / ${totalIterations}`
                  : `${iteration} / ${totalIterations}`}
                {status === 'completed' && ' — Completed'}
              </span>
            </div>
          )}
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-green-600/70 transition-[width] duration-300"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>
              {/* P1 clarity: in Repeat the bar is per-iteration, so label it
                  "Current progress" instead of a bare percentage. */}
              {totalIterations !== undefined && totalIterations > 1 ? 'Current progress' : 'Progress'}{' '}
              {(progress * 100).toFixed(0)}%
            </span>
            <span>{elapsedSecs.toFixed(1)}s elapsed</span>
          </div>
        </section>
      </div>
    </div>
  )
}
