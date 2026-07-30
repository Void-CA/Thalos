import { sceneApi } from '@/features/viewport/api/scene-api'
import type { RuntimeDelta } from '@/features/viewport/api/scene-api.types'

/**
 * ExecutionClient — transporte puro.
 *
 * Habla con la API de ejecución del backend.
 * No tiene estado, no conoce React, no conoce stores.
 *
 * Si el backend migra de HTTP polling a WebSocket,
 * solo cambia este archivo — el resto del sistema no se entera.
 */
export const executionClient = {
  /** Compile + schedule a motion program (load into runtime, don't start). */
  load: (segments: { type: string; target: unknown }[]) =>
    sceneApi.previewPlan({ segments }),

  /** Start execution of the scheduled plan. */
  start: () => sceneApi.startExecution(),

  /** Pause a running execution. */
  pause: () => sceneApi.pauseExecution(),

  /** Resume a paused execution. */
  resume: () => sceneApi.resumeExecution(),

  /** Cancel execution. */
  cancel: () => sceneApi.cancelExecution(),

  /** Reset execution session back to idle. */
  reset: () => sceneApi.resetExecution(),

  /** Advance execution by `dt` seconds. Returns joints + frame transforms. */
  tick: (dt: number): Promise<RuntimeDelta> => sceneApi.tickExecution(dt),
}
