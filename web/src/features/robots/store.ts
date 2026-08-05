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

  /**
   * Select a catalog robot as a REQUEST (spec R5.2, design D8).
   *
   * NOT authoritative: the CONFIRMED identity lives in the scene runtime
   * (`runtime.robot.id`), written only by applyScene. `select` only records
   * what the user asked for; AppShell's useSceneRobotSync turns it into a
   * backend load via useLoadRobot. The catalog-only guard stays: unknown ids
   * — including URDF identities (`urdf:*`) — never enter the selection.
   */
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
