// ── Mirror de DTOs backend ──
// Fuente de verdad: backend/crates/thalos-api/src/features/scene/dto/responses.rs

import type { RobotMetadataDto } from '../robots/robot-api.types';

export interface VisualFrameDto {
  id: string;
  parent: string | null;
  translation: [number, number, number];
  rotation: [number, number, number, number];
}

export interface VisualLinkDto {
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
