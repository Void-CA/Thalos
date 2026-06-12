use std::sync::Arc;

use axum::{extract::State, Json};

use thalos_runtime::{commands::motion::MotionCommands, Command};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::motion::dto::*;

/// Execute a joint-space motion command.
///
/// Plans a trapezoidal trajectory from the current joint
/// configuration to `target` and stores the active trajectory
/// in the runtime. The joints are set to the final target position.
pub async fn movej(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveJRequest>,
) -> ApiResult<MotionResponse> {
    let target = payload.target.clone();

    state
        .services
        .scene
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: target.clone(),
            max_velocity: payload.velocity,
            max_acceleration: payload.acceleration,
            time_step: None,
        }))?;

    Ok(Json(MotionResponse {
        status: "accepted".into(),
        target_joints: target,
        message: "joint-space trajectory planned and stored".into(),
    }))
}

/// Execute a cartesian / linear motion command.
///
/// Samples a linear path in task space, solves IK for each waypoint,
/// and produces a joint-space trajectory stored in the runtime.
pub async fn movel(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveLRequest>,
) -> ApiResult<MotionResponse> {
    let snapshot = state.services.scene.snapshot()?;
    let default_ee = *snapshot.chain.end_effector();
    let frame = payload
        .frame_id
        .map_or(default_ee, thalos_core::spatial::frame::FrameId::Id);
    let target_pose = payload.target.to_pose(frame);

    let snapshot = state.services.scene.execute(Command::Motion(
        MotionCommands::PlanAndMoveL {
            frame,
            target_pose,
            max_velocity: payload.velocity,
            max_acceleration: payload.acceleration,
            time_step: None,
            cartesian_step: None,
        },
    ))?;

    Ok(Json(MotionResponse {
        status: "accepted".into(),
        target_joints: snapshot.joints,
        message: "cartesian trajectory planned and stored".into(),
    }))
}
