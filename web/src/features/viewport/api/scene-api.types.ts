// ── Mirror de DTOs backend ──
// Fuente de verdad: backend/crates/thalos-api/src/features/scene/dto/responses.rs

import type { RobotMetadataDto } from '@/features/robots/api/robot-api.types'

// ── Visual scene DTOs ──

export interface FrameStyleDto {
  axis_length: number
  axis_radius: number
  origin_radius: number
  show_labels: boolean
  color_x: [number, number, number]
  color_y: [number, number, number]
  color_z: [number, number, number]
}

export interface VisualFrameDto {
  id: string
  parent: string | null
  translation: [number, number, number]
  rotation: [number, number, number, number]
  style: FrameStyleDto | null
}

export interface VisualLinkDto {
  id: number
  start: [number, number, number]
  end: [number, number, number]
}

export type RotationDto =
  | { kind: 'Quaternion'; value: { w: number; x: number; y: number; z: number } }
  | { kind: 'Ypr'; value: { roll: number; pitch: number; yaw: number } }

export interface PoseTargetDto {
  translation: [number, number, number]
  rotation: RotationDto
}

export interface VisualJointAxisDto {
  origin: [number, number, number]
  axis: [number, number, number]
}

export interface VisualTwistDto {
  origin: [number, number, number]
  linear: [number, number, number]
  angular: [number, number, number]
}

export interface VisualPrimitiveDto {
  id: string
  frame_id: string
  translation: [number, number, number]
  rotation: [number, number, number, number]
  geometry: PrimitiveGeometryDto
  color?: [number, number, number, number]
}

export type PrimitiveGeometryDto =
  | { Cylinder: { radius: number; height: number } }
  | { Sphere: { radius: number } }
  | { Box: { width: number; height: number; depth: number } }

export interface VisualSceneDto {
  frames: VisualFrameDto[]
  links: VisualLinkDto[]
  joint_axes: VisualJointAxisDto[]
  twists: VisualTwistDto[]
  primitives: VisualPrimitiveDto[]
  reference_dimension?: number
}

// ── Runtime state ──

export interface IkResultDto {
  status: 'Converged' | 'MaxIterations'
  iterations: number
  final_error: number
}

export interface ToolFrameDto {
  base_frame_id: number
  offset?: [number, number, number] | null
}

export interface ExecutionInfoDto {
  status: string
  progress: number
  elapsed_secs: number
}

export interface RuntimeStateResponse {
  robot: RobotMetadataDto
  joints: number[]
  scene: VisualSceneDto
  ik_result: IkResultDto | null
  active_plan: ActivePlanDto | null
  active_tcp?: ToolFrameDto | null
  execution?: ExecutionInfoDto | null
  generated_at: string
}

// ── Active plan ──

export interface ActivePlanDto {
  plan_id: string
  state: string
  motion_type: string
  trajectory_progress: number | null
  visualization: TrajectoryVisualizationDto | null
  segments?: SegmentInfoDto[] | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface SegmentInfoDto {
  segment_index: number
  motion_type: string
  waypoint_start: number
  waypoint_end: number
  time_start: number
  time_end: number
}

export interface TrajectoryVisualizationDto {
  waypoints: VisualWaypointDto[]
  motion_type: string
}

export type WaypointTypeDto = 'Start' | 'Goal' | 'Via'

export interface VisualWaypointDto {
  position: [number, number, number]
  orientation: [number, number, number, number]
  joints: number[]
  timestamp: number
  waypoint_type: WaypointTypeDto
}

// ── Runtime delta (execution streaming) ──

export interface TransformUpdate {
  id: string
  translation: [number, number, number]
  rotation: [number, number, number, number]
  scale: [number, number, number]
}

export interface RuntimeDelta {
  joints: number[]
  transforms: TransformUpdate[]
  execution: ExecutionDto
}

export interface ExecutionDto {
  status: ExecutionStatusDto
  progress: number
  elapsed_secs: number
}

export type ExecutionStatusDto = 'Created' | 'Active' | 'Paused' | 'Completed' | 'Cancelled' | 'Failed' | 'Idle'

// ── IK response ──

export interface SolveIKResponse {
  joints: number[]
  ik_result: IkResultDto
}

// ── Error ──

export interface ErrorResponse {
  error: string
  code: string
}
