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
  generated_at: string;
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
  target: {
    translation: [number, number, number];
    rotation: [number, number, number, number];
  };
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
