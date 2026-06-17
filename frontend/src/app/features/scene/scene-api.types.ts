// ── Mirror de DTOs backend ──
// Fuente de verdad: backend/crates/thalos-api/src/features/scene/dto/responses.rs

import type { RobotMetadataDto } from '../robots/robot-api.types';

export interface FrameStyleDto {
  axis_length: number;
  axis_radius: number;
  origin_radius: number;
  show_labels: boolean;
  color_x: [number, number, number];
  color_y: [number, number, number];
  color_z: [number, number, number];
}

export interface VisualFrameDto {
  id: string;
  parent: string | null;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  style: FrameStyleDto | null;
}

export interface VisualLinkDto {
  id: number;
  start: [number, number, number];
  end: [number, number, number];
}

// ── IK request types (wire format = mirror de thalos_api::RotationDto) ──

/**
 * Rotation input — the client picks the representation that fits the user.
 * Single source of truth for the math lives in `thalos_core::UnitQuaternion`.
 *
 * Wire format (serde tagged enum):
 *   { kind: 'Quaternion', value: { w, x, y, z } }
 *   { kind: 'Ypr',        value: { roll, pitch, yaw } }   // ZYX intrinsic, radians
 */
export type RotationDto =
  | { kind: 'Quaternion'; value: { w: number; x: number; y: number; z: number } }
  | { kind: 'Ypr'; value: { roll: number; pitch: number; yaw: number } };

export interface PoseTargetDto {
  translation: [number, number, number];
  rotation: RotationDto;
}

export interface VisualJointAxisDto {
  origin: [number, number, number];
  axis: [number, number, number];
}

export interface VisualTwistDto {
  origin: [number, number, number];
  linear: [number, number, number];
  angular: [number, number, number];
}

export interface VisualPrimitiveDto {
  id: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  geometry: PrimitiveGeometryDto;
}

export type PrimitiveGeometryDto =
  | { Cylinder: { radius: number; height: number } }
  | { Sphere: { radius: number } }
  | { Box: { width: number; height: number; depth: number } };

export interface VisualSceneDto {
  frames: VisualFrameDto[];
  links: VisualLinkDto[];
  joint_axes: VisualJointAxisDto[];
  twists: VisualTwistDto[];
  primitives: VisualPrimitiveDto[];
}

export interface RuntimeStateResponse {
  robot: RobotMetadataDto;
  joints: number[];
  scene: VisualSceneDto;
  ik_result: IkResultDto | null;
  active_plan: ActivePlanDto | null;
  generated_at: string;
}

// ── Active plan DTOs ──

export interface ActivePlanDto {
  plan_id: string;
  state: string;
  motion_type: string;
  trajectory_progress: number | null;
  visualization: TrajectoryVisualizationDto | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TrajectoryVisualizationDto {
  waypoints: VisualWaypointDto[];
  motion_type: string;
}

export type WaypointTypeDto = 'Start' | 'Goal' | 'Via';

export interface VisualWaypointDto {
  position: [number, number, number];
  orientation: [number, number, number, number];
  joints: number[];
  timestamp: number;
  waypoint_type: WaypointTypeDto;
}

export interface ValidateResponse {
  valid: boolean;
  error: string | null;
}

export interface SceneDiffDto {
  frames_removed: string[];
  frames_added: string[];
  changed_frames: ChangedFrameDto[];
}

export interface ChangedFrameDto {
  id: string;
  translation_delta: number;
  rotation_angle_deg: number;
}

export interface ErrorResponse {
  error: string;
  code: string;
}


// ── IK endpoint types ──

export interface MoveToPositionRequest {
  target: [number, number, number];
  frame_id?: number;
}

export interface MoveToPoseRequest {
  target: PoseTargetDto;
  frame_id?: number;
}

export interface IkResultDto {
  status: 'Converged' | 'MaxIterations';
  iterations: number;
  final_error: number;
}

export interface SolveIKResponse {
  joints: number[];
  ik_result: IkResultDto;
}

export interface ExecuteIKRequest {
  joint_angles: number[];
}
