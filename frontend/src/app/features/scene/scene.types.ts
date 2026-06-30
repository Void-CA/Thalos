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
export interface SceneFrameStyle {
  axisLength: number;
  axisRadius: number;
  originRadius: number;
  showLabels: boolean;
  colorX: [number, number, number];
  colorY: [number, number, number];
  colorZ: [number, number, number];
}

export const DEFAULT_FRAME_STYLE: SceneFrameStyle = {
  axisLength: 0.18,
  axisRadius: 0.006,
  originRadius: 0,
  showLabels: false,
  colorX: [1.0, 0.5, 0.0],
  colorY: [0.0, 0.8, 0.0],
  colorZ: [0.0, 0.5, 1.0],
};

export interface SceneFrame {
  id: string;
  parent: string | null;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  style: SceneFrameStyle | null;
}

export interface SceneLink {
  /** Joint id of the segment that produced this link. Stable, unique within
   *  the chain. Used by the renderer as the reconciliation key. */
  id: string;
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
  frameId: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  geometry: PrimitiveGeometry;
  /** RGBA (0..1 each) from URDF material, or null if unspecified. */
  color: [number, number, number, number] | null;
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
  /** Dimensión de referencia del robot en metros — usada para grid, gizmos, fit. */
  referenceDimension: number;
}

// ── IK types ──

import type { RotationDto } from './scene-api.types';

/** Target para un comando IK. La rotación usa el mismo wire format que la API. */
export interface IkTarget {
  type: 'position' | 'pose';
  translation: [number, number, number];
  rotation?: RotationDto;
}

/** Comando IK enviado al store. */
export interface IkCommand {
  type: 'moveToPosition' | 'moveToPose';
  target: IkTarget;
}

/** Resultado del solver IK (mirror de IkResultDto). */
export interface IkResult {
  status: 'Converged' | 'MaxIterations';
  iterations: number;
  finalError: number;
}

/** Estado puramente de UI — NO existe en el backend. */
export interface SceneUiState {
  loading: boolean;
  error: string | null;
}

// ── Execution types (desde RuntimeDelta) ──

export type ExecutionStatus = 'Created' | 'Active' | 'Paused' | 'Completed' | 'Cancelled' | 'Failed' | 'Idle';

export interface ExecutionInfo {
  status: ExecutionStatus;
  progress: number;
  elapsedSecs: number;
}

/** Pose actualizada de un objeto del scene graph durante runtime. */
export interface ObjectTransform {
  id: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

/** Estado completo del store — runtime snapshot + datos de escena + IK + plan activo + estado de UI. */
export interface SceneState {
  data: SceneData | null;
  runtime: RuntimeInfo | null;
  /// Transformaciones actualizadas por RuntimeDelta (renderizado incremental).
  liveTransforms: ObjectTransform[];
  /// Estado de ejecución actualizado por RuntimeDelta.
  execution: ExecutionInfo | null;
  ikResult: IkResult | null;
  solvedQ: number[] | null;
  ikTarget: IkTarget | null;
  activePlan: ActivePlan | null;
  ui: SceneUiState;
}

// ── Active plan types ──

export interface ActivePlan {
  planId: string;
  state: string;
  motionType: string;
  trajectoryProgress: number | null;
  visualization: TrajectoryVisualization | null;
  segments?: SegmentInfo[] | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SegmentInfo {
  segmentIndex: number;
  motionType: string;
  waypointStart: number;
  waypointEnd: number;
  timeStart: number;
  timeEnd: number;
}

export interface TrajectoryVisualization {
  waypoints: VisualWaypoint[];
  motionType: string;
}

export type WaypointType = 'Start' | 'Goal' | 'Via';

export interface VisualWaypoint {
  position: [number, number, number];
  orientation: [number, number, number, number];
  joints: number[];
  timestamp: number;
  waypointType: WaypointType;
}
