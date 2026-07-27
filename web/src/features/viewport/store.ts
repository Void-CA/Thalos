import { create } from 'zustand'
import type { SceneData, RuntimeInfo, IkResult, IkTarget, ActivePlan, ToolFrame, ExecutionInfo, ObjectTransform } from './types'

export type TrajectoryColorMode = 'segment' | 'trajectory-quality' | 'manipulability' | 'singularity'

export interface SceneState {
  data: SceneData | null
  runtime: RuntimeInfo | null
  liveTransforms: ObjectTransform[]
  execution: ExecutionInfo | null
  ikResult: IkResult | null
  solvedQ: number[] | null
  ikTarget: IkTarget | null
  activePlan: ActivePlan | null
  activeTcp: ToolFrame | null
  loading: boolean
  error: string | null
  trajectoryColorMode: TrajectoryColorMode
}

interface SceneActions {
  applyScene: (data: SceneData, runtime: RuntimeInfo, ikResult: IkResult | null, activePlan: ActivePlan | null, activeTcp: ToolFrame | null, execution: ExecutionInfo | null) => void
  applyFkUpdate: (data: SceneData, runtime: RuntimeInfo, ikResult: IkResult | null, activeTcp: ToolFrame | null) => void
  applyRuntimeDelta: (joints: number[], transforms: ObjectTransform[], execution: ExecutionInfo) => void
  setIkTarget: (target: IkTarget | null) => void
  setTrajectoryColorMode: (mode: TrajectoryColorMode) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

const INITIAL: SceneState = {
  data: null,
  runtime: null,
  liveTransforms: [],
  execution: null,
  ikResult: null,
  solvedQ: null,
  ikTarget: null,
  activePlan: null,
  activeTcp: null,
  loading: false,
  error: null,
  trajectoryColorMode: 'segment',
}

export const useSceneStore = create<SceneState & SceneActions>((set) => ({
  ...INITIAL,

  applyScene: (data, runtime, ikResult, activePlan, activeTcp, execution) => set({
    data, runtime, liveTransforms: [], execution, ikResult,
    solvedQ: null, activePlan, activeTcp, loading: false, error: null,
  }),

  applyFkUpdate: (data, runtime, ikResult, activeTcp) => set((state) => ({
    data, runtime, liveTransforms: [], execution: null, ikResult,
    solvedQ: null, ikTarget: state.ikTarget, activePlan: state.activePlan, activeTcp,
    loading: false, error: null,
  })),

  applyRuntimeDelta: (joints, transforms, execution) => set((state) => ({
    runtime: state.runtime ? { ...state.runtime, joints } : state.runtime,
    liveTransforms: transforms, execution,
  })),

  setIkTarget: (target) => set({ ikTarget: target }),
  setTrajectoryColorMode: (trajectoryColorMode) => set({ trajectoryColorMode }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set(INITIAL),
}))
