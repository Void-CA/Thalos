import { create } from 'zustand'
import type { SceneData, RuntimeInfo, IkResult, IkTarget, ActivePlan, ToolFrame, ExecutionInfo, ObjectTransform, TransformSnapshot, FkFrameMap, SceneFrame } from './types'

export type TrajectoryColorMode = 'segment' | 'trajectory-quality' | 'manipulability' | 'singularity'
export type TrajectoryViewMode = 'original' | 'optimized'

export interface SceneState {
  data: SceneData | null
  runtime: RuntimeInfo | null
  liveTransforms: ObjectTransform[]
  transformSnapshot: TransformSnapshot
  execution: ExecutionInfo | null
  ikResult: IkResult | null
  solvedQ: number[] | null
  ikTarget: IkTarget | null
  activePlan: ActivePlan | null
  optimizedPositions: number[][] | null
  trajectoryViewMode: TrajectoryViewMode
  activeTcp: ToolFrame | null
  loading: boolean
  error: string | null
  trajectoryColorMode: TrajectoryColorMode
}

interface SceneActions {
  applyScene: (data: SceneData, runtime: RuntimeInfo, ikResult: IkResult | null, activePlan: ActivePlan | null, activeTcp: ToolFrame | null, execution: ExecutionInfo | null) => void
  applyFkUpdate: (data: SceneData, runtime: RuntimeInfo, ikResult: IkResult | null, activeTcp: ToolFrame | null) => void
  /** Write an FK transform snapshot from backend `scene.frames` (POST /scene/joints). */
  applyFkPlayback: (frames: FkFrameMap) => void
  applyRuntimeDelta: (joints: number[], transforms: ObjectTransform[], execution: ExecutionInfo) => void
  setIkTarget: (target: IkTarget | null) => void
  setTrajectoryColorMode: (mode: TrajectoryColorMode) => void
  setTrajectoryViewMode: (mode: TrajectoryViewMode) => void
  setOptimizedPositions: (positions: number[][] | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

const INITIAL: SceneState = {
  data: null,
  runtime: null,
  liveTransforms: [],
  transformSnapshot: { kind: 'idle' },
  execution: null,
  ikResult: null,
  solvedQ: null,
  ikTarget: null,
  activePlan: null,
  optimizedPositions: null,
  trajectoryViewMode: 'original',
  activeTcp: null,
  loading: false,
  error: null,
  trajectoryColorMode: 'segment',
}

/** Build the FK frame map from backend `scene.frames` (id → {pos, quat}). */
function fkFramesFromScene(frames: SceneFrame[]): FkFrameMap {
  const map: FkFrameMap = new Map()
  for (const frame of frames) map.set(frame.id, { pos: frame.translation, quat: frame.rotation })
  return map
}

export const useSceneStore = create<SceneState & SceneActions>((set) => ({
  ...INITIAL,

  applyScene: (data, runtime, ikResult, activePlan, activeTcp, execution) => set({
    data, runtime, liveTransforms: [], transformSnapshot: { kind: 'idle' }, execution, ikResult,
    solvedQ: null, activePlan, activeTcp, loading: false, error: null,
    optimizedPositions: null,
    trajectoryViewMode: 'original',
  }),

  applyFkUpdate: (data, runtime, ikResult, activeTcp) => set((state) => ({
    data, runtime, liveTransforms: [], transformSnapshot: { kind: 'fk', frames: fkFramesFromScene(data.frames) }, execution: null, ikResult,
    solvedQ: null, ikTarget: state.ikTarget, activePlan: state.activePlan, activeTcp,
    loading: false, error: null,
  })),

  applyFkPlayback: (frames) => set({ transformSnapshot: { kind: 'fk', frames } }),

  applyRuntimeDelta: (joints, transforms, execution) => set((state) => ({
    runtime: state.runtime ? { ...state.runtime, joints } : state.runtime,
    liveTransforms: transforms, transformSnapshot: { kind: 'execution', transforms }, execution,
  })),

  setIkTarget: (target) => set({ ikTarget: target }),
  setTrajectoryColorMode: (trajectoryColorMode) => set({ trajectoryColorMode }),
  setTrajectoryViewMode: (trajectoryViewMode) => set({ trajectoryViewMode }),
  setOptimizedPositions: (optimizedPositions) => set({ optimizedPositions }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set(INITIAL),
}))
