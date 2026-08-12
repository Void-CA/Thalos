import { create } from 'zustand'
import { useWorkspaceStore } from '@/features/workspace-analysis/workspace-analysis-store'
import type { SceneData, RuntimeInfo, IkResult, IkTarget, ActivePlan, ToolFrame, ExecutionInfo, ObjectTransform, TransformSnapshot, FkFrameMap, SceneFrame } from './types'

export type TrajectoryColorMode = 'segment' | 'trajectory-quality' | 'manipulability' | 'singularity'
export type TrajectoryViewMode = 'original' | 'optimized' | 'preview'

export interface SceneState {
  data: SceneData | null
  runtime: RuntimeInfo | null
  transformSnapshot: TransformSnapshot
  execution: ExecutionInfo | null
  ikResult: IkResult | null
  solvedQ: number[] | null
  ikTarget: IkTarget | null
  activePlan: ActivePlan | null
  optimizedPositions: number[][] | null
  /** End-effector waypoints of the PREVIEWED recommendation edit (PR3) —
   *  drives the same 3D overlay mechanism as `optimizedPositions`. */
  previewPositions: number[][] | null
  trajectoryViewMode: TrajectoryViewMode
  activeTcp: ToolFrame | null
  loading: boolean
  error: string | null
  /** Machine-readable error code from the backend (resilience-matrix spec).
   *  Kept separate so ErrorBox can render the correct CTA (e.g. not_found →
   *  "Back to catalog") without breaking string-only callers. */
  errorCode: string | null
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
  setPreviewPositions: (positions: number[][] | null) => void
  setLoading: (loading: boolean) => void
  /** Preserve the machine-readable code so ErrorBox renders the right CTA.
   *  `setError(msg)` keeps code as-is; `setError(msg, code)` updates both. */
  setError: (error: string | null, code?: string | null) => void
  reset: () => void
}

const INITIAL: SceneState = {
  data: null,
  runtime: null,
  transformSnapshot: { kind: 'idle' },
  execution: null,
  ikResult: null,
  solvedQ: null,
  ikTarget: null,
  activePlan: null,
  optimizedPositions: null,
  previewPositions: null,
  trajectoryViewMode: 'original',
  activeTcp: null,
  loading: false,
  error: null,
  errorCode: null,
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

  applyScene: (data, runtime, ikResult, activePlan, activeTcp, execution) => {
    // Cascade invalidation (spec R4, design D5): workspace samples describe
    // the PREVIOUS robot's workspace. When the confirmed robot identity
    // (runtime.robot.id, single source from the backend via applyScene)
    // changes, clear them — but NEVER on every applyScene (36+ callers
    // refresh the same robot, e.g. IK/plan previews).
    const prevRobotId = useSceneStore.getState().runtime?.robot.id ?? null
    if (prevRobotId !== runtime.robot.id) {
      useWorkspaceStore.getState().reset()
    }
    set({
      data, runtime, transformSnapshot: { kind: 'idle' }, execution, ikResult,
      solvedQ: null, activePlan, activeTcp, loading: false, error: null,
      optimizedPositions: null,
      previewPositions: null,
      trajectoryViewMode: 'original',
    })
  },

  applyFkUpdate: (data, runtime, ikResult, activeTcp) => set((state) => ({
    data, runtime, transformSnapshot: { kind: 'fk', frames: fkFramesFromScene(data.frames) }, execution: null, ikResult,
    solvedQ: null, ikTarget: state.ikTarget, activePlan: state.activePlan, activeTcp,
    loading: false, error: null,
  })),

  applyFkPlayback: (frames) => set({ transformSnapshot: { kind: 'fk', frames } }),

  applyRuntimeDelta: (joints, transforms, execution) => set((state) => ({
    runtime: state.runtime ? { ...state.runtime, joints } : state.runtime,
    transformSnapshot: { kind: 'execution', transforms }, execution,
  })),

  setIkTarget: (target) => set({ ikTarget: target }),
  setTrajectoryColorMode: (trajectoryColorMode) => set({ trajectoryColorMode }),
  setTrajectoryViewMode: (trajectoryViewMode) => set({ trajectoryViewMode }),
  setOptimizedPositions: (optimizedPositions) => set({ optimizedPositions }),
  setPreviewPositions: (previewPositions) => set({ previewPositions }),
  setLoading: (loading) => set({ loading }),
  setError: (error, code) => set((state) => ({
    error,
    errorCode: code === undefined ? state.errorCode : code,
    loading: false,
  })),
  reset: () => set(INITIAL),
}))
