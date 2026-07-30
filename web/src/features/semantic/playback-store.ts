import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Waypoint } from './types'

interface PlaybackState {
  /** The full list of waypoints for the current plan */
  waypoints: Waypoint[]
  /** Total duration of the plan in seconds */
  totalDuration: number
  /** Current playback time in seconds */
  currentTime: number
  /** Whether playback is active */
  isPlaying: boolean
  /** Playback speed multiplier */
  speed: number

  loadPlan: (waypoints: Waypoint[], totalDuration: number) => void
  setCurrentTime: (t: number) => void
  setIsPlaying: (v: boolean) => void
  setSpeed: (s: number) => void
  reset: () => void
}

export const usePlaybackStore = create<PlaybackState>()(
  devtools(
    (set) => ({
      waypoints: [],
      totalDuration: 0,
      currentTime: 0,
      isPlaying: false,
      speed: 1,

      loadPlan: (waypoints, totalDuration) =>
        set({ waypoints, totalDuration, currentTime: 0, isPlaying: false }),

      setCurrentTime: (currentTime) => set({ currentTime }),

      setIsPlaying: (isPlaying) => set({ isPlaying }),

      setSpeed: (speed) => set({ speed }),

      reset: () =>
        set({ waypoints: [], totalDuration: 0, currentTime: 0, isPlaying: false, speed: 1 }),
    }),
    { name: 'playback' },
  ),
)
