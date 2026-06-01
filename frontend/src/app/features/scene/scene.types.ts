// ── Runtime/UI state — solo frontend ──
// Dependencias mínimas de tipos API para el runtime snapshot.
// NOTA: Se importa RobotMetadataDto en scene-api.types, no acá.
// La información de runtime (robot name, DOF, etc.) se extrae
// del RuntimeStateResponse en el store y se mapea a este tipo.

import type { RobotMetadataDto } from '../robots/robot-api.types';

/** Snapshot del runtime activo: qué robot está cargado y en qué ángulos. */
export interface RuntimeInfo {
  robot: RobotMetadataDto;
  joints: number[];
  generatedAt: string;
}

/** Modelo interno de frames renderizables. */
export interface SceneFrame {
  id: string;
  parent: string | null;
  translation: [number, number, number];
  rotation: [number, number, number, number];
}

export interface SceneLink {
  start: [number, number, number];
  end: [number, number, number];
}

export interface SceneJointAxis {
  origin: [number, number, number];
  axis: [number, number, number];
}

export interface SceneTwist {
  origin: [number, number, number];
  linear: [number, number, number];
  angular: [number, number, number];
}

export interface ScenePrimitive {
  id: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  geometry: PrimitiveGeometry;
}

export type PrimitiveGeometry =
  | { type: 'cylinder'; radius: number; height: number }
  | { type: 'sphere'; radius: number }
  | { type: 'box'; width: number; height: number; depth: number };

/** Escena deserializada y lista para consumo interno (renderer, interacción, etc.). */
export interface SceneData {
  frames: SceneFrame[];
  links: SceneLink[];
  jointAxes: SceneJointAxis[];
  twists: SceneTwist[];
  primitives: ScenePrimitive[];
}

/** Estado puramente de UI — NO existe en el backend. */
export interface SceneUiState {
  loading: boolean;
  error: string | null;
}

/** Estado completo del store — runtime snapshot + datos de escena + estado de UI. */
export interface SceneState {
  data: SceneData | null;
  runtime: RuntimeInfo | null;
  ui: SceneUiState;
}
