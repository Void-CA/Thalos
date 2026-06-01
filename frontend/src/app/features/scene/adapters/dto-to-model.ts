// ── Adapter: VisualSceneDto (API contract) → SceneData (runtime state) ──

import type { VisualSceneDto, PrimitiveGeometryDto, FrameStyleDto } from '../scene-api.types';
import type { SceneData, SceneFrame, SceneFrameStyle, SceneJointAxis, SceneLink, ScenePrimitive, SceneTwist } from '../scene.types';

export function toSceneData(dto: VisualSceneDto): SceneData {
  return {
    frames: dto.frames.map(toFrame),
    links: dto.links.map(toLink),
    jointAxes: dto.joint_axes.map(toJointAxis),
    twists: dto.twists.map(toTwist),
    primitives: dto.primitives.map(toPrimitive),
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
    translation: dto.translation,
    rotation: dto.rotation,
    geometry: toGeometry(dto.geometry),
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
