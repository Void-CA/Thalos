// ── Planning domain types ──
// Modelos de datos para waypoints, planes, segmentos y errores de planificación.
// Independientes de los tipos scene-api — se mapean desde/hacia API DTOs en los servicios.

export type WaypointType = 'Start' | 'Goal' | 'Via';

// ── Segment types ──

export type SegmentKind = 'movej' | 'movel';

export interface SegmentModel {
  kind: SegmentKind;
  expanded: boolean;
  // MoveJ
  joints: number[];
  // MoveL
  txStr: string;
  tyStr: string;
  tzStr: string;
  rotationFormat: 'euler' | 'quaternion';
  yawStr: string;
  pitchStr: string;
  rollStr: string;
  qwStr: string;
  qxStr: string;
  qyStr: string;
  qzStr: string;
  frameIdStr: string;
  // Common
  velocityStr: string;
}

export function createSegment(kind: SegmentKind, dof: number): SegmentModel {
  return {
    kind,
    expanded: true,
    joints: new Array(dof).fill(0),
    txStr: '0.3',
    tyStr: '0',
    tzStr: '0',
    rotationFormat: 'euler',
    yawStr: '0',
    pitchStr: '0',
    rollStr: '0',
    qwStr: '1',
    qxStr: '0',
    qyStr: '0',
    qzStr: '0',
    frameIdStr: '',
    velocityStr: '',
  };
}

export interface WaypointModel {
  id: string;
  position: [number, number, number];
  orientation: [number, number, number, number];
  joints: number[];
  type: WaypointType;
}

export interface PlanModel {
  id: string;
  name: string;
  segments: unknown[];     // MotionSegmentDto[] — from scene-api.types
  waypoints: WaypointModel[];
  createdAt: string;
  updatedAt: string;
}

export type ErrorCategory = 'joint_limit' | 'workspace' | 'collision' | 'velocity' | 'unknown';

export interface SegmentError {
  category: ErrorCategory;
  message: string;
  segmentIndex?: number;
}

export interface ValidationResult {
  category: ErrorCategory;
  message: string;
  segmentIndex?: number;
  details?: Record<string, unknown>;
}
