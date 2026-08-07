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
    /// Dimensión de referencia del robot (metros). El frontend la usa para
    /// escalar grid, gizmos y la cámara Fit Robot.
    ///
    /// Default 1.0 para backward compat con backends que no emiten el campo.
    #[serde(default = "default_ref_dim_dto")]
    pub reference_dimension: f64,
}

/// 1 metro asumido cuando el backend no envía `reference_dimension`.
fn default_ref_dim_dto() -> f64 {
    1.0
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
    /// ID visual del frame padre. El frontend cuelga la primitive como hija
    /// de este frame en el scene graph.
    pub frame_id: String,
    /// Transformación LOCAL (relativa al frame padre).
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
    /// Active Tool Center Point (TCP) frame.
    ///
    /// When `Some`, all analysis (workspace, singularity, manipulability)
    /// and IK default to this TCP instead of the flange (end_effector).
    /// When `None`, the flange is used as the default working frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_tcp: Option<ToolFrameDto>,
    /// Estado de ejecución (presente cuando hay una sesión activa).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<ExecutionDto>,
    pub generated_at: DateTime<Utc>,
}

/// Active Tool Center Point (TCP) frame exposed by the API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolFrameDto {
    /// The frame ID this TCP is attached to.
    pub base_frame_id: u64,
    /// Offset from the base frame. `None` means identity (TCP coincides with base_frame).
    /// Format: `[x, y, z]` translation in meters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<[f64; 3]>,
    /// Pose of the TCP resolved by forward kinematics (world frame).
    ///
    /// `None` when the TCP is inactive or FK cannot resolve the base frame
    /// (e.g. frame missing from the chain). Computed in the mapper via
    /// `FKResult::tcp_pose` — zero-cost reuse of the snapshot's FK result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_pose: Option<ResolvedPoseDto>,
}

/// Resolved TCP pose (world frame) — flat mirror of the frontend `PoseDef`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResolvedPoseDto {
    /// Translation `[x, y, z]` in meters.
    pub position: [f64; 3],
    /// Unit quaternion `[w, x, y, z]` (matches `RotationDto::Quaternion`).
    pub orientation: [f64; 4],
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
    /// Per-segment metadata for multi-segment programs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<SegmentInfoDto>>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Segment metadata for multi-segment motion programs.
#[derive(Debug, Serialize)]
pub struct SegmentInfoDto {
    pub segment_index: usize,
    pub motion_type: String,
    pub waypoint_start: usize,
    pub waypoint_end: usize,
    pub time_start: f64,
    pub time_end: f64,
    /// The original source command (intent) — canonical `MotionSegment` serde.
    ///
    /// The editable program representation: the frontend renders it as the
    /// editable segment and keeps the compiled trajectory (waypoint ranges)
    /// alongside it for execution feedback.
    pub source: thalos_core::motion::segment::MotionSegment,
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

// ── Runtime delta DTOs ──

/// Actualización de pose de un objeto del scene graph en un tick.
///
/// Genérica: el `id` puede referirse a un frame, un link o cualquier otro
/// elemento visual registrado en el renderer. El backend no necesita saber
/// qué tipo de objeto es — solo su nueva pose.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransformUpdate {
    pub id: String,
    pub translation: [f64; 3],
    pub rotation: [f64; 4],
    pub scale: [f64; 3],
}

/// Estado dinámico del motor: solo lo que cambia en cada tick.
///
/// A diferencia de `RuntimeStateResponse`, no incluye escena, primitivas,
/// frames, metadata del robot ni trayectoria planificada — todo eso es
/// inmutable durante la ejecución y se obtiene via `GET /scene`.
#[derive(Debug, Serialize)]
pub struct RuntimeDelta {
    /// Current joint angles (usado por el FK panel).
    pub joints: Vec<f64>,
    /// Transformaciones de objetos del scene graph (frames + links).
    pub transforms: Vec<TransformUpdate>,
    pub execution: ExecutionDto,
}

/// Estado de la sesión de ejecución en un instante dado.
#[derive(Debug, Serialize)]
pub struct ExecutionDto {
    pub status: ExecutionStatusDto,
    pub progress: f64,
    pub elapsed_secs: f64,
    /// Origen de la ejecución ("Simulation" | "Hardware" | "Replay #N") —
    /// informativo para el badge de backend source (PR4, item 9).
    /// Aditivo y opcional: los clientes antiguos ignoran el campo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Status de la sesión — tipado hasta el borde de la API.
///
/// Serialeable a JSON como string, deserialeable desde el frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExecutionStatusDto {
    #[serde(rename = "Created")]
    Ready,
    #[serde(rename = "Active")]
    Running,
    #[serde(rename = "Paused")]
    Paused,
    #[serde(rename = "Completed")]
    Completed,
    #[serde(rename = "Cancelled")]
    Cancelled,
    #[serde(rename = "Failed")]
    Failed,
    #[serde(rename = "Idle")]
    Idle,
}
