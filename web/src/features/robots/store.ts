import { create } from 'zustand'
import type { RobotMetadataDto } from './api/robot-api.types'

interface RobotState {
  robots: RobotMetadataDto[]
  selectedId: string | null
  loading: boolean
  error: string | null

  setRobots: (robots: RobotMetadataDto[]) => void
  select: (id: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useRobotStore = create<RobotState>((set, get) => ({
  robots: [],
  selectedId: null,
  loading: false,
  error: null,

  setRobots: (robots) => set({ robots, error: null }),

  select: (id) => {
    const { robots } = get()
    if (id === null || robots.some(r => r.id === id)) {
      set({ selectedId: id })
    }
  },

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))

/** Computed-style selector: el robot seleccionado (derivado). */
export const useSelectedRobot = () => {
  const robots = useRobotStore(s => s.robots)
  const selectedId = useRobotStore(s => s.selectedId)
  return robots.find(r => r.id === selectedId) ?? null
}
