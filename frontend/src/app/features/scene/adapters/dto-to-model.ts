// ── Adapter: VisualSceneDto (API contract) → SceneData (runtime state) ──

import type { ActivePlanDto, SegmentInfoDto, TrajectoryVisualizationDto, VisualSceneDto, PrimitiveGeometryDto, FrameStyleDto, VisualWaypointDto } from '../scene-api.types';
import type { ActivePlan, SceneData, SceneFrame, SceneFrameStyle, SceneJointAxis, SceneLink, ScenePrimitive, SceneTwist, SegmentInfo, TrajectoryVisualization, VisualWaypoint } from '../scene.types';

export function toSceneData(dto: VisualSceneDto): SceneData {
  return {
    frames: dto.frames.map(toFrame),
    links: dto.links.map(toLink),
    jointAxes: dto.joint_axes.map(toJointAxis),
    twists: dto.twists.map(toTwist),
    primitives: dto.primitives.map(toPrimitive),
    referenceDimension: dto.reference_dimension ?? 1.0,
  };
}

function toFrame(dto: VisualSceneDto['frames'][number]): SceneFrame {
  return {
    id: dto.id,
    parent: dto.parent,
    translation: dto.translation,
    rotation: dto.rotation,
    style: dto.style ? toFrameStyle(dto.style) : null,
  };
}

function toFrameStyle(dto: FrameStyleDto): SceneFrameStyle {
  return {
    axisLength: dto.axis_length,
    axisRadius: dto.axis_radius,
    originRadius: dto.origin_radius,
    showLabels: dto.show_labels,
    colorX: dto.color_x,
    colorY: dto.color_y,
    colorZ: dto.color_z,
  };
}

function toLink(dto: VisualSceneDto['links'][number]): SceneLink {
  return {
    id: String(dto.id),
    start: dto.start,
    end: dto.end,
  };
}

function toJointAxis(dto: VisualSceneDto['joint_axes'][number]): SceneJointAxis {
  return {
    origin: dto.origin,
    axis: dto.axis,
  };
}

function toTwist(dto: VisualSceneDto['twists'][number]): SceneTwist {
  return {
    origin: dto.origin,
    linear: dto.linear,
    angular: dto.angular,
  };
}

function toPrimitive(dto: VisualSceneDto['primitives'][number]): ScenePrimitive {
  return {
    id: dto.id,
    frameId: dto.frame_id,
    translation: dto.translation,
    rotation: dto.rotation,
    geometry: toGeometry(dto.geometry),
    color: dto.color ?? null,
  };
}

function toGeometry(dto: PrimitiveGeometryDto): ScenePrimitive['geometry'] {
  if ('Cylinder' in dto) {
    return { type: 'cylinder', ...dto.Cylinder };
  }
  if ('Sphere' in dto) {
    return { type: 'sphere', ...dto.Sphere };
  }
  // Box
  return { type: 'box', ...dto.Box };
}

// ── ActivePlan adapters ──

export function toActivePlan(dto: ActivePlanDto | null): ActivePlan | null {
  if (!dto) return null;
  return {
    planId: dto.plan_id,
    state: dto.state,
    motionType: dto.motion_type,
    trajectoryProgress: dto.trajectory_progress,
    visualization: dto.visualization ? toTrajectoryVisualization(dto.visualization) : null,
    segments: dto.segments?.map(toSegmentInfo) ?? null,
    createdAt: dto.created_at,
    startedAt: dto.started_at,
    completedAt: dto.completed_at,
  };
}

function toSegmentInfo(dto: SegmentInfoDto): SegmentInfo {
  return {
    segmentIndex: dto.segment_index,
    motionType: dto.motion_type,
    waypointStart: dto.waypoint_start,
    waypointEnd: dto.waypoint_end,
    timeStart: dto.time_start,
    timeEnd: dto.time_end,
  };
}

function toTrajectoryVisualization(dto: TrajectoryVisualizationDto): TrajectoryVisualization {
  return {
    waypoints: dto.waypoints.map(toVisualWaypoint),
    motionType: dto.motion_type,
  };
}

function toVisualWaypoint(dto: VisualWaypointDto): VisualWaypoint {
  return {
    position: dto.position,
    orientation: dto.orientation,
    joints: dto.joints,
    timestamp: dto.timestamp,
    waypointType: dto.waypoint_type,
  };
}
