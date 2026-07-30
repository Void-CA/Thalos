import { compileSemantic, planMotion } from '../api'
import { usePlaybackStore } from '../playback-store'
import { useSceneStore } from '@/features/viewport/store'
import type { TaskDocument } from '../types'

/**
 * Orchestrates the full semantic execution pipeline:
 *
 * TaskDocument → compile → MotionProgram → plan → waypoints → viewport
 */
export async function runTask(task: TaskDocument) {
  // 1. Compile
  const compileResult = await compileSemantic({ task })
  if (compileResult.status !== 'ok') {
    throw new Error(
      compileResult.validation.errors.join('; ') || 'Compilation failed',
    )
  }

  // 2. Plan
  const planResult = await planMotion(compileResult.motion_program)
  if (planResult.status !== 'ok') {
    throw new Error('Planning failed')
  }

  // 3. Load into playback store
  const playback = usePlaybackStore.getState()
  playback.loadPlan(planResult.waypoints, planResult.total_duration_secs)

  // 4. Start playback
  playback.setIsPlaying(true)
  startPlaybackLoop()
}

let animationFrameId: number | null = null
let playbackStartTime = 0

function startPlaybackLoop() {
  const state = usePlaybackStore.getState()
  if (!state.isPlaying || state.waypoints.length === 0) return

  playbackStartTime = performance.now() - state.currentTime * 1000

  if (animationFrameId) cancelAnimationFrame(animationFrameId)

  function tick() {
    const s = usePlaybackStore.getState()
    if (!s.isPlaying) {
      animationFrameId = null
      return
    }

    const elapsed = (performance.now() - playbackStartTime) / 1000
    const virtualTime = elapsed * s.speed

    if (virtualTime >= s.totalDuration) {
      // End of playback
      usePlaybackStore.getState().setIsPlaying(false)
      if (s.waypoints.length > 0) {
        const last = s.waypoints[s.waypoints.length - 1]
        useSceneStore.getState().applyRuntimeDelta(last.joints, [], {
          status: 'completed',
          progress: 1,
          elapsedSecs: s.totalDuration,
        })
      }
      animationFrameId = null
      return
    }

    // Find current waypoint by time
    let currentJoints = s.waypoints[0]?.joints ?? []
    for (let i = s.waypoints.length - 1; i >= 0; i--) {
      if (s.waypoints[i].time_secs <= virtualTime) {
        currentJoints = s.waypoints[i].joints
        break
      }
    }

    // Update viewport
    useSceneStore.getState().applyRuntimeDelta(currentJoints, [], {
      status: 'running',
      progress: s.totalDuration > 0 ? virtualTime / s.totalDuration : 0,
      elapsedSecs: virtualTime,
    })

    // Update playback time
    usePlaybackStore.getState().setCurrentTime(virtualTime)

    animationFrameId = requestAnimationFrame(tick)
  }

  animationFrameId = requestAnimationFrame(tick)
}

/** Stop playback */
export function stopPlayback() {
  usePlaybackStore.getState().setIsPlaying(false)
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
}
