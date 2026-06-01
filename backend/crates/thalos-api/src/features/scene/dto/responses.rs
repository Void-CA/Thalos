use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use thalos_runtime::RuntimeSnapshot;
use thalos_visual::{
    ChangedFrame, FrameStyle, PrimitiveGeometry, SceneDiff, VisualFrame, VisualJointAxis,
    VisualLink, VisualPrimitive, VisualScene, VisualTwist,
};

use crate::features::robots::dto::RobotMetadataDto;


// ── Scene response DTOs ──

/// Public contract: mirror of `thalos_visual::VisualScene` but owned by the API layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualSceneDto {
    pub frames: Vec<VisualFrameDto>,
    pub links: Vec<VisualLinkDto>,
    pub joint_axes: Vec<VisualJointAxisDto>,
    pub twists: Vec<VisualTwistDto>,
    pub primitives: Vec<VisualPrimitiveDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrameStyleDto {
    pub axis_length: f64,
    pub axis_radius: f64,
    pub origin_radius: f64,
    pub show_labels: bool,
    pub color_x: [f64; 3],
    pub color_y: [f64; 3],
    pub color_z: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualFrameDto {
    pub id: String,
    pub parent: Option<String>,
    pub translation: [f64; 3],
    pub rotation: [f64; 4],
    #[serde(default)]
    pub style: Option<FrameStyleDto>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PrimitiveGeometryDto {
    Cylinder { radius: f64, height: f64 },
    Sphere { radius: f64 },
    Box { width: f64, height: f64, depth: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualPrimitiveDto {
    pub id: String,
    pub translation: [f64; 3],
    pub rotation: [f64; 4],
    pub geometry: PrimitiveGeometryDto,
}


// ── Runtime response ──

/// Full runtime state: the active robot, its joint angles, and the computed scene.
/// Returned by every endpoint that touches the runtime.
#[derive(Debug, Serialize)]
pub struct RuntimeStateResponse {
    pub robot: RobotMetadataDto,
    pub joints: Vec<f64>,
    pub scene: VisualSceneDto,
    pub generated_at: DateTime<Utc>,
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


// ── RuntimeSnapshot → RuntimeStateResponse ──

impl From<RuntimeSnapshot> for RuntimeStateResponse {
    fn from(s: RuntimeSnapshot) -> Self {
        Self {
            robot: s.robot.metadata().into(),
            joints: s.joints,
            scene: s.scene.into(),
            generated_at: s.generated_at,
        }
    }
}

// ── Domain → DTO conversions ──

impl From<FrameStyle> for FrameStyleDto {
    fn from(s: FrameStyle) -> Self {
        Self {
            axis_length: s.axis_length,
            axis_radius: s.axis_radius,
            origin_radius: s.origin_radius,
            show_labels: s.show_labels,
            color_x: s.color_x,
            color_y: s.color_y,
            color_z: s.color_z,
        }
    }
}

impl From<VisualFrame> for VisualFrameDto {
    fn from(f: VisualFrame) -> Self {
        Self {
            id: f.id,
            parent: f.parent,
            translation: f.translation,
            rotation: f.rotation,
            style: f.style.map(Into::into),
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

impl From<PrimitiveGeometry> for PrimitiveGeometryDto {
    fn from(g: PrimitiveGeometry) -> Self {
        match g {
            PrimitiveGeometry::Cylinder { radius, height } => Self::Cylinder { radius, height },
            PrimitiveGeometry::Sphere { radius } => Self::Sphere { radius },
            PrimitiveGeometry::Box { width, height, depth } => Self::Box { width, height, depth },
        }
    }
}

impl From<VisualPrimitive> for VisualPrimitiveDto {
    fn from(p: VisualPrimitive) -> Self {
        Self {
            id: p.id,
            translation: p.translation,
            rotation: p.rotation,
            geometry: p.geometry.into(),
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
            primitives: s.primitives.into_iter().map(Into::into).collect(),
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

impl From<FrameStyleDto> for FrameStyle {
    fn from(s: FrameStyleDto) -> Self {
        Self {
            axis_length: s.axis_length,
            axis_radius: s.axis_radius,
            origin_radius: s.origin_radius,
            show_labels: s.show_labels,
            color_x: s.color_x,
            color_y: s.color_y,
            color_z: s.color_z,
        }
    }
}

impl From<VisualFrameDto> for VisualFrame {
    fn from(f: VisualFrameDto) -> Self {
        Self {
            id: f.id,
            parent: f.parent,
            translation: f.translation,
            rotation: f.rotation,
            style: f.style.map(Into::into),
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

impl From<PrimitiveGeometryDto> for PrimitiveGeometry {
    fn from(g: PrimitiveGeometryDto) -> Self {
        match g {
            PrimitiveGeometryDto::Cylinder { radius, height } => Self::Cylinder { radius, height },
            PrimitiveGeometryDto::Sphere { radius } => Self::Sphere { radius },
            PrimitiveGeometryDto::Box { width, height, depth } => Self::Box { width, height, depth },
        }
    }
}

impl From<VisualPrimitiveDto> for VisualPrimitive {
    fn from(p: VisualPrimitiveDto) -> Self {
        Self {
            id: p.id,
            translation: p.translation,
            rotation: p.rotation,
            geometry: p.geometry.into(),
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
            primitives: s.primitives.into_iter().map(Into::into).collect(),
        }
    }
}
