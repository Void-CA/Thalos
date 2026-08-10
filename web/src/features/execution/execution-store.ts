import { create } from 'zustand'
import { executionClient } from './execution-client'
import { useSceneStore } from '@/features/viewport/store'
import { isApiError } from '@/shared/errors'
import type { ExecutionModeDto } from '@/features/viewport/api/scene-api.types'
import type { ObjectTransform, ExecutionInfo } from '@/features/viewport/types'

// ── Status ────────────────────────────────────────────────────────────────
// Misma semántica que backend ExecutionStatusDto, pero en camelCase
// para el frontend. Terminales: completed | cancelled | failed
export type ExecutionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

const TERMINAL = new Set<ExecutionStatus>(['completed', 'cancelled', 'failed'])

// ── Active plan ────────────────────────────────────────────────────────────

/** Plan metadata captured at the Send-to-Execution handoff — feeds the Active
 *  Plan card in the Execution workspace (execution-workspace spec). The plan
 *  itself lives in the backend runtime; the store only mirrors the summary. */
export interface ActivePlanInfo {
  instructionCount: number
  /** Backend-computed execution total from `POST /semantic/execute`. */
  durationSecs: number
  /** Where the plan came from — the handoff sources it from Task. */
  source: string
}

// ── State ─────────────────────────────────────────────────────────────────

/** Structured execution error (error-ux spec): the backend machine-readable
 *  `code` is preserved alongside the display `message` so the UI can render a
 *  code→CTA string instead of raw text. */
export interface ExecutionError {
  message: string
  code?: string
}

export interface ExecutionState {
  status: ExecutionStatus
  joints: number[]
  transforms: ObjectTransform[]
  /** Execution progress as a fraction 0..1 of the loaded plan, sourced from
   *  the tick delta (`RuntimeDelta.execution.progress`). */
  progress: number
  /** Elapsed seconds since plan start (tick delta `elapsed_secs`). */
  elapsedSecs: number
  error: ExecutionError | null
  /** Summary of the loaded plan; null until a plan is handed off. */
  activePlan: ActivePlanInfo | null
  /** Execution mode of the running session (EW1). Defaults to once. */
  mode: ExecutionModeDto
  /** Current iteration, 1-based (EW3). Sourced from the tick delta. */
  iteration: number
  /** Total iterations; undefined for Once → no badge (EW6). */
  totalIterations?: number
}

interface ExecutionActions {
  /** Iniciar (o reanudar) la ejecución del plan cargado. Optional mode —
   *  absent defaults to `once` (current behavior). */
  start: (mode?: ExecutionModeDto) => Promise<void>

  /** Pausar una ejecución activa. */
  pause: () => Promise<void>

  /** Reanudar una ejecución pausada. */
  resume: () => Promise<void>

  /** Cancelar la ejecución actual. */
  cancel: () => Promise<void>

  /** Resetear la sesión de ejecución. */
  reset: () => Promise<void>

  /** Handoff reception (Invariant #5): the Task workspace hands a compiled
   *  plan to the runtime via `POST /semantic/execute` (no `start()`) and
   *  records it here. Sets `status = ready` — the tick loop is NOT started;
   *  only `start()` (from the Execution workspace) begins it. */
  receivePlan: (plan: ActivePlanInfo) => void
}

// ── Estado inicial ────────────────────────────────────────────────────────

const INITIAL: ExecutionState = {
  status: 'idle',
  joints: [],
  transforms: [],
  progress: 0,
  elapsedSecs: 0,
  error: null,
  activePlan: null,
  mode: 'once',
  iteration: 1,
  totalIterations: undefined,
}

/** Normalize any thrown error to `{message, code}` (error-ux spec): the
 *  ApiError code survives into the store state so the workspace can render
 *  the code→CTA mapping. Plain errors keep only their message. */
function toExecutionError(err: unknown): ExecutionError {
  if (isApiError(err)) {
    return { message: err.message, code: err.code }
  }
  return { message: err instanceof Error ? err.message : 'Operation failed' }
}

// ── Loop privado ──────────────────────────────────────────────────────────

let loopId: number | null = null
let lastTick = 0

function stopLoop() {
  if (loopId !== null) {
    cancelAnimationFrame(loopId)
    loopId = null
  }
}

function startLoop() {
  if (loopId !== null) return
  lastTick = performance.now()

  const loop = async (now: number) => {
    const dt = Math.min((now - lastTick) / 1000, 0.1) // clamp >100ms → 100ms
    lastTick = now

    try {
      const delta = await executionClient.tick(dt)

      // An in-flight tick may resolve after pause/cancel/completion — never
      // clobber the viewport with stale transforms from a superseded session.
      if (useExecutionStore.getState().status !== 'running') {
        stopLoop()
        return
      }

      // Convertir DTO → tipo interno (mismas shape, distinto módulo)
      const transforms = delta.transforms as unknown as ObjectTransform[]
      const executionInfo: ExecutionInfo = {
        status: delta.execution.status,
        progress: delta.execution.progress,
        elapsedSecs: delta.execution.elapsed_secs,
        source: delta.execution.source,
      }

      // Escribir el snapshot de ejecución para el viewport (single source of truth)
      useSceneStore.getState().applyRuntimeDelta(delta.joints, transforms, executionInfo)

      // Mapear estado del backend al nuestro
      const status = mapStatus(delta.execution.status)
      const isTerminal = TERMINAL.has(status)

      useExecutionStore.setState({
        joints: delta.joints,
        transforms,
        progress: delta.execution.progress,
        elapsedSecs: delta.execution.elapsed_secs,
        status,
        // Backend is the source of truth for repeat state (EW3): the tick
        // delta reports the CURRENT iteration and total. Absent fields
        // (legacy backend / Once) keep the defaults.
        mode: delta.execution.mode ?? 'once',
        iteration: delta.execution.iteration ?? 1,
        totalIterations: delta.execution.total_iterations,
      })

      if (isTerminal) {
        stopLoop()
        return
      }
    } catch (err) {
      stopLoop()
      useExecutionStore.setState({ status: 'failed', error: toExecutionError(err) })
      return
    }

    loopId = requestAnimationFrame(loop)
  }

  loopId = requestAnimationFrame(loop)
}

/** Mapea ExecutionStatusDto del backend a nuestro status local. */
function mapStatus(dto: string): ExecutionStatus {
  switch (dto) {
    case 'Active':
    case 'Running':
      return 'running'
    case 'Paused':
      return 'paused'
    case 'Completed':
      return 'completed'
    case 'Cancelled':
      return 'cancelled'
    case 'Failed':
      return 'failed'
    case 'Ready':
      return 'ready'
    default:
      return 'idle'
  }
}

// ── Store ─────────────────────────────────────────────────────────────────

export const useExecutionStore = create<ExecutionState & ExecutionActions>((set) => ({
  ...INITIAL,

  receivePlan: (plan) => set({ activePlan: plan, status: 'ready' }),

  start: async (mode?: ExecutionModeDto) => {
    try {
      await executionClient.start(mode)
      // Seed the iteration badge from the requested mode; the first tick then
      // confirms it from the backend. Once / absent → no badge (EW6).
      const total = mode !== undefined && mode !== 'once' ? mode.repeat.count : undefined
      set({ status: 'running', mode: mode ?? 'once', iteration: 1, totalIterations: total })
      startLoop()
    } catch (err) {
      set({ status: 'failed', error: toExecutionError(err) })
    }
  },

  pause: async () => {
    try {
      await executionClient.pause()
      stopLoop()
      set({ status: 'paused' })
    } catch (err) {
      set({ status: 'failed', error: toExecutionError(err) })
    }
  },

  resume: async () => {
    try {
      await executionClient.resume()
      set({ status: 'running' })
      startLoop()
    } catch (err) {
      set({ status: 'failed', error: toExecutionError(err) })
    }
  },

  cancel: async () => {
    try {
      await executionClient.cancel()
      stopLoop()
      set({ status: 'cancelled' })
    } catch (err) {
      set({ status: 'failed', error: toExecutionError(err) })
    }
  },

  reset: async () => {
    try {
      await executionClient.reset()
      stopLoop()
      set({ ...INITIAL })
    } catch (err) {
      set({ status: 'failed', error: toExecutionError(err) })
    }
  },
}))
