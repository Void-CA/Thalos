// ── Adapter: VisualSceneDto (API contract) → SceneData (runtime state) ──

import type { VisualSceneDto } from '../scene-api.types';
import type { SceneData, SceneFrame, SceneJointAxis, SceneLink, SceneTwist } from '../scene.types';

export function toSceneData(dto: VisualSceneDto): SceneData {
  return {
    frames: dto.frames.map(toFrame),
    links: dto.links.map(toLink),
    jointAxes: dto.joint_axes.map(toJointAxis),
    twists: dto.twists.map(toTwist),
  };
}

function toFrame(dto: VisualSceneDto['frames'][number]): SceneFrame {
  return {
    id: dto.id,
    parent: dto.parent,
    translation: dto.translation,
    rotation: dto.rotation,
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
