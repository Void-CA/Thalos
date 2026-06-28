// ── Scene response DTOs (data-only) ──
// Conversions (`From` impls) live in `super::mappers/`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thalos_core::robot::joint::JointId;

use crate::features::robots::dto::RobotMetadataDto;

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
    /// Joint id of the segment that produced this link. Stable, unique within
    /// the chain. Mirrors `thalos_visual::VisualLink::id`.
    pub id: JointId,
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
    /// RGBA color from URDF `<material>`, omitted when unspecified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<[f64; 4]>,
}

// ── Runtime response ──

/// Result of an IK solver execution (DTO mirror of core's IKResult without the q vector).
#[derive(Debug, Serialize)]
pub struct IkResultDto {
    pub status: String,
    pub iterations: usize,
    pub final_error: f64,
}

/// Result of a solve-only IK request: joint angles + solver metadata, without mutating state.
#[derive(Debug, Serialize)]
pub struct SolveIKResponse {
    pub joints: Vec<f64>,
    pub ik_result: IkResultDto,
}

/// Full runtime state: the active robot, its joint angles, the computed scene,
/// and any active motion plan.
///
/// Returned by every endpoint that touches the runtime.
/// When produced by an IK command, `ik_result` carries solver metadata.
/// When a motion plan is active, `active_plan` carries plan state + visualization.
///
/// Construction is in `mappers::runtime`.
#[derive(Debug, Serialize)]
pub struct RuntimeStateResponse {
    pub robot: RobotMetadataDto,
    pub joints: Vec<f64>,
    pub scene: VisualSceneDto,
    pub ik_result: Option<IkResultDto>,
    pub active_plan: Option<ActivePlanDto>,
    pub generated_at: DateTime<Utc>,
}

// ── Plan and trajectory visualisation DTOs ──

/// Active motion plan metadata exposed by the API.
#[derive(Debug, Serialize)]
pub struct ActivePlanDto {
    pub plan_id: String,
    pub state: String,
    pub motion_type: String,
    pub trajectory_progress: Option<f64>,
    pub visualization: Option<TrajectoryVisualizationDto>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Trajectory visualisation — the data contract for the frontend's 3D renderer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrajectoryVisualizationDto {
    pub waypoints: Vec<VisualWaypointDto>,
    pub motion_type: String,
}

/// Semantic role of a waypoint — frontend uses this to pick colours.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WaypointTypeDto {
    Start,
    Goal,
    Via,
}

/// A single waypoint in 3D space for the frontend to render.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualWaypointDto {
    pub position: [f64; 3],
    pub orientation: [f64; 4],
    pub joints: Vec<f64>,
    pub timestamp: f64,
    pub waypoint_type: WaypointTypeDto,
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
