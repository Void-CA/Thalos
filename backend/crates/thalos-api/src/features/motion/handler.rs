use std::sync::Arc;

use axum::{extract::State, Json};

use thalos_runtime::{commands::motion::MotionCommands, Command};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::motion::dto::*;

/// Execute a joint-space motion command.
///
/// Currently plans a trapezoidal trajectory from the current joint
/// configuration to `target` and sets the final position. Full trajectory
/// execution (interpolation, real-time monitoring) will be added as part
/// of the trajectory lifecycle work (#23).
pub async fn movej(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveJRequest>,
) -> ApiResult<MotionResponse> {
    let target = payload.target.clone();

    state
        .services
        .scene
        .execute(Command::Motion(MotionCommands::MoveJ { target: target.clone() }))?;

    Ok(Json(MotionResponse {
        status: "accepted".into(),
        target_joints: target,
        message: "joint-space move command accepted".into(),
    }))
}

/// Execute a cartesian / linear motion command.
///
/// Samples a linear path in task space, solves IK for each waypoint,
/// and produces a joint-space trajectory.
///
/// **Note**: Full cartesian planning is not yet implemented. This endpoint
/// currently performs a single IK solve and accepts the result as the
/// final configuration. Sequential IK + interpolation will be added with
/// the planner integration.
pub async fn movel(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveLRequest>,
) -> ApiResult<MotionResponse> {
    let snapshot = state.services.scene.snapshot()?;
    let default_ee = *snapshot.chain.end_effector();
    let frame = payload.frame_id.map_or(default_ee, thalos_core::spatial::frame::FrameId::Id);
    let target_pose = payload.target.to_pose(frame);

    let (_joints, _ik) = state.services.scene.solve_ik(frame, thalos_core::kinematics::inverse::IKGoal::Pose(target_pose))?;

    // TODO(#23): Use IK result to plan a full linear trajectory instead
    // of jumping directly to the final configuration.

    let target_joints = _joints.clone();
    state
        .services
        .scene
        .execute(Command::Motion(MotionCommands::MoveJ { target: _joints }))?;

    Ok(Json(MotionResponse {
        status: "accepted".into(),
        target_joints,
        message: "cartesian move command accepted (single-shot IK, full trajectory pending #23)"
            .into(),
    }))
}
