import type { RuntimeStateResponse } from './api/scene-api.types'
import type {
  SceneData,
  SceneFrame,
  SceneLink,
  SceneJointAxis,
  SceneTwist,
  ScenePrimitive,
  PrimitiveGeometry,
  ActivePlan,
  ToolFrame,
  IkResult,
  ExecutionInfo,
  RuntimeInfo,
} from './types'

/** Convertir DTOs a SceneData interno. */
export function toSceneData(dto: RuntimeStateResponse['scene']): SceneData {
  return {
    frames: dto.frames.map(toFrame),
    links: dto.links.map(toLink),
    jointAxes: dto.joint_axes.map(toJointAxis),
    twists: dto.twists.map(toTwist),
    primitives: dto.primitives.map(toPrimitive),
    referenceDimension: dto.reference_dimension ?? 1.0,
  }
}

function toFrame(dto: RuntimeStateResponse['scene']['frames'][0]): SceneFrame {
  return {
    id: dto.id,
    parent: dto.parent,
    translation: dto.translation,
    rotation: dto.rotation,
    style: dto.style ? {
      axisLength: dto.style.axis_length,
      axisRadius: dto.style.axis_radius,
      originRadius: dto.style.origin_radius,
      showLabels: dto.style.show_labels,
      colorX: dto.style.color_x,
      colorY: dto.style.color_y,
      colorZ: dto.style.color_z,
    } : null,
  }
}

function toLink(dto: RuntimeStateResponse['scene']['links'][0]): SceneLink {
  return {
    id: String(dto.id),
    start: dto.start,
    end: dto.end,
  }
}

function toJointAxis(dto: RuntimeStateResponse['scene']['joint_axes'][0]): SceneJointAxis {
  return { origin: dto.origin, axis: dto.axis }
}

function toTwist(dto: RuntimeStateResponse['scene']['twists'][0]): SceneTwist {
  return { origin: dto.origin, linear: dto.linear, angular: dto.angular }
}

function toPrimitive(dto: RuntimeStateResponse['scene']['primitives'][0]): ScenePrimitive {
  let geometry: PrimitiveGeometry
  if ('Cylinder' in dto.geometry) {
    geometry = { type: 'cylinder', ...dto.geometry.Cylinder }
  } else if ('Sphere' in dto.geometry) {
    geometry = { type: 'sphere', ...dto.geometry.Sphere }
  } else {
    const b = (dto.geometry as { Box: { width: number; height: number; depth: number } }).Box
    geometry = { type: 'box', ...b }
  }

  return {
    id: dto.id,
    frameId: dto.frame_id,
    translation: dto.translation,
    rotation: dto.rotation,
    geometry,
    color: dto.color ?? null,
  }
}

/** Convertir RuntimeStateResponse completo a estado interno. */
export function toRuntimeInfo(dto: RuntimeStateResponse): RuntimeInfo {
  return {
    robot: dto.robot,
    joints: dto.joints,
    generatedAt: dto.generated_at,
  }
}

export function toIkResult(dto: RuntimeStateResponse['ik_result']): IkResult | null {
  if (!dto) return null
  return {
    status: dto.status,
    iterations: dto.iterations,
    finalError: dto.final_error,
  }
}

export function toActivePlan(dto: RuntimeStateResponse['active_plan']): ActivePlan | null {
  if (!dto) return null
  return {
    planId: dto.plan_id,
    state: dto.state,
    motionType: dto.motion_type,
    trajectoryProgress: dto.trajectory_progress,
    visualization: dto.visualization
      ? { waypoints: dto.visualization.waypoints, motionType: dto.visualization.motion_type }
      : null,
    segments: dto.segments?.map(s => ({
      segmentIndex: s.segment_index,
      motionType: s.motion_type,
      waypointStart: s.waypoint_start,
      waypointEnd: s.waypoint_end,
      timeStart: s.time_start,
      timeEnd: s.time_end,
      source: s.source,
    })) ?? null,
    createdAt: dto.created_at,
    startedAt: dto.started_at,
    completedAt: dto.completed_at,
  }
}

export function toToolFrame(dto: RuntimeStateResponse['active_tcp']): ToolFrame | null {
  if (!dto) return null
  return {
    baseFrameId: dto.base_frame_id,
    offset: dto.offset ?? null,
    resolvedPose: dto.resolved_pose ?? null,
  }
}

export function toExecutionInfo(dto: RuntimeStateResponse['execution']): ExecutionInfo | null {
  if (!dto) return null
  return {
    status: dto.status,
    progress: dto.progress,
    elapsedSecs: dto.elapsed_secs,
    source: dto.source,
  }
}
