import { compileSemantic, planMotion } from '../api'
import { usePlaybackStore } from '../playback-store'
import { useSceneStore } from '@/features/viewport/store'
import type { TaskDocument } from '../types'

let tickTimer: ReturnType<typeof setInterval> | null = null
let playbackStartTime = 0

const TICK_INTERVAL = 50 // ms, like Angular's tick approach
const TICK_DT = TICK_INTERVAL / 1000

/**
 * Orchestrates the full semantic execution pipeline.
 *
 * Uses the backend's FK endpoint to compute frame transforms
 * at each tick, matching the Angular simulation approach.
 */
export async function runTask(task: TaskDocument) {
  // 1. Compile
  const compileResult = await compileSemantic({ task })
  if (compileResult.status !== 'ok') {
    throw new Error(compileResult.validation.errors.join('; ') || 'Compilation failed')
  }

  // 2. Plan → waypoints
  const planResult = await planMotion(compileResult.motion_program)
  if (planResult.status !== 'ok') throw new Error('Planning failed')

  // 3. Load into playback store
  const playback = usePlaybackStore.getState()
  playback.loadPlan(planResult.waypoints, planResult.total_duration_secs)

  // 4. Start tick loop
  playback.setIsPlaying(true)
  playbackStartTime = performance.now()
  startTickLoop()
}

function getJointsAtTime(waypoints: { time_secs: number; joints: number[] }[], t: number): number[] {
  if (waypoints.length === 0) return []
  for (let i = waypoints.length - 1; i >= 0; i--) {
    if (waypoints[i].time_secs <= t) return waypoints[i].joints
  }
  return waypoints[0].joints
}

function startTickLoop() {
  stopTickLoop()

  tickTimer = setInterval(async () => {
    const s = usePlaybackStore.getState()
    if (!s.isPlaying) { stopTickLoop(); return }

    const elapsed = (performance.now() - playbackStartTime) / 1000
    const virtualTime = elapsed * s.speed

    if (virtualTime >= s.totalDuration) {
      // End
      usePlaybackStore.getState().setIsPlaying(false)
      const last = s.waypoints[s.waypoints.length - 1]
      if (last) {
        // Fetch final FK
        try {
          const fkRes = await fetch('/api/v1/planning/fk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ joints: last.joints }),
          })
          const fkData = await fkRes.json()
          useSceneStore.getState().applyRuntimeDelta(last.joints, [], {
            status: 'completed', progress: 1, elapsedSecs: s.totalDuration,
          }, fkData.frames)
        } catch {
          useSceneStore.getState().applyRuntimeDelta(last.joints, [], {
            status: 'completed', progress: 1, elapsedSecs: s.totalDuration,
          })
        }
      }
      stopTickLoop()
      return
    }

    // Find current joints
    const joints = getJointsAtTime(s.waypoints, virtualTime)

    // Fetch FK from backend
    try {
      const res = await fetch('/api/v1/planning/fk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joints }),
      })
      if (res.ok) {
        const fkData = await res.json()
        useSceneStore.getState().applyRuntimeDelta(joints, [], {
          status: 'running',
          progress: s.totalDuration > 0 ? virtualTime / s.totalDuration : 0,
          elapsedSecs: virtualTime,
        }, fkData.frames)
      } else {
        // Fallback: update joints without frames
        useSceneStore.getState().applyRuntimeDelta(joints, [], {
          status: 'running',
          progress: s.totalDuration > 0 ? virtualTime / s.totalDuration : 0,
          elapsedSecs: virtualTime,
        })
      }
    } catch {
      // Fallback
      useSceneStore.getState().applyRuntimeDelta(joints, [], {
        status: 'running',
        progress: s.totalDuration > 0 ? virtualTime / s.totalDuration : 0,
        elapsedSecs: virtualTime,
      })
    }

    usePlaybackStore.getState().setCurrentTime(virtualTime)
  }, TICK_INTERVAL)
}

function stopTickLoop() {
  if (tickTimer !== null) { clearInterval(tickTimer); tickTimer = null; }
}

/** Stop playback */
export function stopPlayback() {
  usePlaybackStore.getState().setIsPlaying(false)
  stopTickLoop()
}
