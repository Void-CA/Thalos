import type { RobotMetadataDto } from '@/features/robots/api/robot-api.types'

/** Snapshot del runtime activo. */
export interface RuntimeInfo {
  robot: RobotMetadataDto
  joints: number[]
  generatedAt: string
}

/** TCP frame. */
export interface ToolFrame {
  baseFrameId: number
  offset: [number, number, number] | null
  /** World-frame pose resolved by backend FK. `null` when TCP inactive or FK fails. */
  resolvedPose: { position: [number, number, number]; orientation: [number, number, number, number] } | null
}

/** Resultado IK. */
export interface IkResult {
  status: 'Converged' | 'MaxIterations'
  iterations: number
  finalError: number
}

/** Execution state. `progress` is a fraction 0..1 of the plan when fed from
 *  the execution-loop ticks (`RuntimeDelta`); `elapsedSecs` is seconds since
 *  plan start. (Full-state backend previews map `progress` = elapsed seconds —
 *  see `ExecutionInfoDto`.) */
export interface ExecutionInfo {
  status: string
  progress: number
  elapsedSecs: number
}

/** Escena lista para renderizar. */
export interface SceneData {
  frames: SceneFrame[]
  links: SceneLink[]
  jointAxes: SceneJointAxis[]
  twists: SceneTwist[]
  primitives: ScenePrimitive[]
  referenceDimension: number
}

export interface SceneFrame {
  id: string
  parent: string | null
  translation: [number, number, number]
  rotation: [number, number, number, number]
  style: FrameStyle | null
}

export interface FrameStyle {
  axisLength: number
  axisRadius: number
  originRadius: number
  showLabels: boolean
  colorX: [number, number, number]
  colorY: [number, number, number]
  colorZ: [number, number, number]
}

export const DEFAULT_FRAME_STYLE: FrameStyle = {
  axisLength: 0.18,
  axisRadius: 0.006,
  originRadius: 0,
  showLabels: false,
  colorX: [1.0, 0.5, 0.0],
  colorY: [0.0, 0.8, 0.0],
  colorZ: [0.0, 0.5, 1.0],
}

export interface SceneLink {
  id: string
  start: [number, number, number]
  end: [number, number, number]
}

export interface SceneJointAxis {
  origin: [number, number, number]
  axis: [number, number, number]
}

export interface SceneTwist {
  origin: [number, number, number]
  linear: [number, number, number]
  angular: [number, number, number]
}

export interface ScenePrimitive {
  id: string
  frameId: string
  translation: [number, number, number]
  rotation: [number, number, number, number]
  geometry: PrimitiveGeometry
  color: [number, number, number, number] | null
}

export type PrimitiveGeometry =
  | { type: 'cylinder'; radius: number; height: number }
  | { type: 'sphere'; radius: number }
  | { type: 'box'; width: number; height: number; depth: number }

/** Plan activo. */
export interface ActivePlan {
  planId: string
  state: string
  motionType: string
  trajectoryProgress: number | null
  visualization: TrajectoryVisualization | null
  segments?: SegmentInfo[] | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface SegmentInfo {
  segmentIndex: number
  motionType: string
  waypointStart: number
  waypointEnd: number
  timeStart: number
  timeEnd: number
}

export interface TrajectoryVisualization {
  waypoints: import('./api/scene-api.types').VisualWaypointDto[]
  motionType: string
}

/** Transform actualizado en runtime. */
export interface ObjectTransform {
  id: string
  translation: [number, number, number]
  rotation: [number, number, number, number]
  scale: [number, number, number]
}

/** Backend FK frame transform (frame id → pose), from `scene.frames`
 *  (`POST /scene/joints`). `quat` is `[w, x, y, z]`. */
export interface FkFrame {
  pos: [number, number, number]
  quat: [number, number, number, number]
}

/** Map of backend FK frame id → frame transform. */
export type FkFrameMap = Map<string, FkFrame>

/**
 * Single source of truth for robot transforms. The renderer NEVER recomputes
 * FK — it applies whatever snapshot it receives.
 * - `execution`: object transforms from a runtime tick (`RuntimeDelta`)
 * - `fk`: frame transforms from backend `scene.frames` (`POST /scene/joints`)
 * - `idle`: no live transform (static scene state)
 */
export type TransformSnapshot =
  | { kind: 'execution'; transforms: ObjectTransform[] }
  | { kind: 'fk'; frames: FkFrameMap }
  | { kind: 'idle' }

/** Target IK para el gizmo. */
export interface IkTarget {
  type: 'position' | 'pose'
  translation: [number, number, number]
  rotation?: import('./api/scene-api.types').RotationDto
}
