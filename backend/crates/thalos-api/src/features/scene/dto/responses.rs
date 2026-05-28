use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use thalos_visual::{
    ChangedFrame,
    SceneDiff,
    VisualFrame,
    VisualJointAxis,
    VisualLink,
    VisualScene,
    VisualTwist,
};


// ── Scene response DTOs ──

/// Public contract: mirror of `thalos_visual::VisualScene` but owned by the API layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualSceneDto {
    pub frames: Vec<VisualFrameDto>,
    pub links: Vec<VisualLinkDto>,
    pub joint_axes: Vec<VisualJointAxisDto>,
    pub twists: Vec<VisualTwistDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualFrameDto {
    pub id: String,
    pub parent: Option<String>,
    pub translation: [f64; 3],
    pub rotation: [f64; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualLinkDto {
    pub start: [f64; 3],
    pub end: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualJointAxisDto {
    pub origin: [f64; 3],
    pub axis: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualTwistDto {
    pub origin: [f64; 3],
    pub linear: [f64; 3],
    pub angular: [f64; 3],
}


// ── Scene response ──

#[derive(Debug, Serialize)]
pub struct SceneStateResponse {
    pub scene: VisualSceneDto,
    pub generated_at: DateTime<Utc>,
}

impl SceneStateResponse {
    pub fn new(scene: VisualSceneDto) -> Self {
        Self {
            scene,
            generated_at: Utc::now(),
        }
    }
}


// ── Validate response ──

#[derive(Debug, Serialize)]
pub struct ValidateResponse {
    pub valid: bool,
    pub error: Option<String>,
}


// ── Diff response DTOs ──

/// Public contract: mirror of `thalos_visual::SceneDiff`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SceneDiffDto {
    pub frames_removed: Vec<String>,
    pub frames_added: Vec<String>,
    pub changed_frames: Vec<ChangedFrameDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChangedFrameDto {
    pub id: String,
    pub translation_delta: f64,
    pub rotation_angle_deg: f64,
}


// ── Domain → DTO conversions ──

impl From<VisualFrame> for VisualFrameDto {
    fn from(f: VisualFrame) -> Self {
        Self {
            id: f.id,
            parent: f.parent,
            translation: f.translation,
            rotation: f.rotation,
        }
    }
}

impl From<VisualLink> for VisualLinkDto {
    fn from(l: VisualLink) -> Self {
        Self {
            start: l.start,
            end: l.end,
        }
    }
}

impl From<VisualJointAxis> for VisualJointAxisDto {
    fn from(a: VisualJointAxis) -> Self {
        Self {
            origin: a.origin,
            axis: a.axis,
        }
    }
}

impl From<VisualTwist> for VisualTwistDto {
    fn from(t: VisualTwist) -> Self {
        Self {
            origin: t.origin,
            linear: t.linear,
            angular: t.angular,
        }
    }
}

impl From<VisualScene> for VisualSceneDto {
    fn from(s: VisualScene) -> Self {
        Self {
            frames: s.frames.into_iter().map(Into::into).collect(),
            links: s.links.into_iter().map(Into::into).collect(),
            joint_axes: s.joint_axes.into_iter().map(Into::into).collect(),
            twists: s.twists.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ChangedFrame> for ChangedFrameDto {
    fn from(c: ChangedFrame) -> Self {
        Self {
            id: c.id,
            translation_delta: c.translation_delta,
            rotation_angle_deg: c.rotation_angle_deg,
        }
    }
}

impl From<SceneDiff> for SceneDiffDto {
    fn from(d: SceneDiff) -> Self {
        Self {
            frames_removed: d.frames_removed,
            frames_added: d.frames_added,
            changed_frames: d.changed_frames.into_iter().map(Into::into).collect(),
        }
    }
}


// ── DTO → Domain conversions (for incoming requests) ──

impl From<VisualFrameDto> for VisualFrame {
    fn from(f: VisualFrameDto) -> Self {
        Self {
            id: f.id,
            parent: f.parent,
            translation: f.translation,
            rotation: f.rotation,
        }
    }
}

impl From<VisualLinkDto> for VisualLink {
    fn from(l: VisualLinkDto) -> Self {
        Self {
            start: l.start,
            end: l.end,
        }
    }
}

impl From<VisualJointAxisDto> for VisualJointAxis {
    fn from(a: VisualJointAxisDto) -> Self {
        Self {
            origin: a.origin,
            axis: a.axis,
        }
    }
}

impl From<VisualTwistDto> for VisualTwist {
    fn from(t: VisualTwistDto) -> Self {
        Self {
            origin: t.origin,
            linear: t.linear,
            angular: t.angular,
        }
    }
}

impl From<VisualSceneDto> for VisualScene {
    fn from(s: VisualSceneDto) -> Self {
        Self {
            frames: s.frames.into_iter().map(Into::into).collect(),
            links: s.links.into_iter().map(Into::into).collect(),
            joint_axes: s.joint_axes.into_iter().map(Into::into).collect(),
            twists: s.twists.into_iter().map(Into::into).collect(),
        }
    }
}
