import { create } from 'zustand'
import { executionClient } from './execution-client'
import { useSceneStore } from '@/features/viewport/store'
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

// ── State ─────────────────────────────────────────────────────────────────

export interface ExecutionState {
  status: ExecutionStatus
  joints: number[]
  transforms: ObjectTransform[]
  progress: number
  elapsedSecs: number
  error: string | null
}

interface ExecutionActions {
  /** Cargar un plan en el runtime sin ejecutarlo. El parámetro es el mismo
   *  `{ segments }` que usa POST /scene/motion/plan. El store no conoce el
   *  origen del plan — puede venir de PlanningPanel, TaskExecutor, Replay… */
  loadExecution: (plan: { segments: { type: string; target: unknown }[] }) => Promise<void>

  /** Iniciar (o reanudar) la ejecución del plan cargado. */
  start: () => Promise<void>

  /** Pausar una ejecución activa. */
  pause: () => Promise<void>

  /** Reanudar una ejecución pausada. */
  resume: () => Promise<void>

  /** Cancelar la ejecución actual. */
  cancel: () => Promise<void>

  /** Resetear la sesión de ejecución. */
  reset: () => Promise<void>
}

// ── Estado inicial ────────────────────────────────────────────────────────

const INITIAL: ExecutionState = {
  status: 'idle',
  joints: [],
  transforms: [],
  progress: 0,
  elapsedSecs: 0,
  error: null,
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

      // Convertir DTO → tipo interno (mismas shape, distinto módulo)
      const transforms = delta.transforms as unknown as ObjectTransform[]
      const executionInfo: ExecutionInfo = {
        status: delta.execution.status,
        progress: delta.execution.progress,
        elapsedSecs: delta.execution.elapsed_secs,
      }

      // Actualizar viewport (Path A en RobotModel)
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
      })

      if (isTerminal) {
        stopLoop()
        return
      }
    } catch (err) {
      stopLoop()
      useExecutionStore.setState({ status: 'failed', error: (err as Error).message })
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

  loadExecution: async (plan) => {
    stopLoop()
    set({ ...INITIAL, status: 'loading' })
    try {
      await executionClient.load(plan.segments)
      set({ status: 'ready' })
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message })
    }
  },

  start: async () => {
    try {
      await executionClient.start()
      set({ status: 'running' })
      startLoop()
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message })
    }
  },

  pause: async () => {
    try {
      await executionClient.pause()
      stopLoop()
      set({ status: 'paused' })
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message })
    }
  },

  resume: async () => {
    try {
      await executionClient.resume()
      set({ status: 'running' })
      startLoop()
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message })
    }
  },

  cancel: async () => {
    try {
      await executionClient.cancel()
      stopLoop()
      set({ status: 'cancelled' })
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message })
    }
  },

  reset: async () => {
    try {
      await executionClient.reset()
      stopLoop()
      set({ ...INITIAL })
    } catch (err) {
      set({ status: 'failed', error: (err as Error).message })
    }
  },
}))
