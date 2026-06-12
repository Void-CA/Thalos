use serde::Deserialize;

use crate::features::scene::dto::requests::PoseTargetDto;

// ── MoveJ (joint-space motion) ─────────────────────────────────────

/// Request to move the robot in joint space.
///
/// The runtime will plan a joint-space trajectory from the current
/// configuration to `target`, respecting optional velocity / acceleration
/// limits. If velocity or acceleration are omitted, the planner uses
/// built-in defaults.
///
/// This endpoint replaces the lower-level `/scene/joints` when the
/// caller wants a smooth interpolated motion rather than a hard set.
#[derive(Debug, Deserialize)]
pub struct MoveJRequest {
    /// Target joint angles in radians.
    pub target: Vec<f64>,
    /// Maximum joint velocity (rad/s). `None` = planner default.
    #[serde(default)]
    pub velocity: Option<f64>,
    /// Maximum joint acceleration (rad/s²). `None` = planner default.
    #[serde(default)]
    pub acceleration: Option<f64>,
}

// ── MoveL (cartesian / linear motion) ──────────────────────────────

/// Request to move the robot in cartesian space.
///
/// The runtime samples a linear path in task space, solves IK for each
/// waypoint, and produces a joint-space trajectory that keeps the end
/// effector (or the specified frame) on the straight-line path.
///
/// Only position is constrained to a line; orientation is interpolated
/// from the start to the target pose.
#[derive(Debug, Deserialize)]
pub struct MoveLRequest {
    /// Which frame to move (defaults to end effector if `None`).
    #[serde(default)]
    pub frame_id: Option<u64>,
    /// Target pose (position + orientation).
    pub target: PoseTargetDto,
    /// Cartesian velocity (m/s). `None` = planner default.
    #[serde(default)]
    pub velocity: Option<f64>,
    /// Cartesian acceleration (m/s²). `None` = planner default.
    #[serde(default)]
    pub acceleration: Option<f64>,
}
