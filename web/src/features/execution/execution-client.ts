import { sceneApi } from '@/features/viewport/api/scene-api'
import type { ExecutionModeDto, RuntimeDelta } from '@/features/viewport/api/scene-api.types'

/**
 * ExecutionClient — pure transport.
 *
 * Talks to the backend execution API.
 * No state, no React, no stores.
 *
 * If the backend migrates from HTTP polling to WebSocket,
 * only this file changes — the rest of the system is unaware.
 */
export const executionClient = {
  /** Start execution of the scheduled plan. Optional mode (absent → once). */
  start: (mode?: ExecutionModeDto) => sceneApi.startExecution(mode),

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
