use std::sync::Arc;

use axum::{Json, extract::State};

use thalos_runtime::{Command, commands::motion::MotionCommands};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::motion::dto::*;
use crate::features::scene::dto::RuntimeStateResponse;
use crate::features::scene::handler::to_api_response;

/// Execute a joint-space motion command.
///
/// Plans a trapezoidal trajectory from the current joint
/// configuration to `target`, stores the active plan in the
/// runtime, and returns the full runtime state including the
/// trajectory visualisation.
pub async fn movej(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveJRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: payload.target.clone(),
            max_velocity: payload.velocity,
            max_acceleration: payload.acceleration,
            time_step: None,
        }))
        .await?;

    Ok(Json(to_api_response(&snapshot)))
}

/// Execute a cartesian / linear motion command.
///
/// Samples a linear path in task space, solves IK for each waypoint,
/// and produces a joint-space trajectory stored in the runtime.
/// Returns the full runtime state including the trajectory visualisation.
pub async fn movel(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveLRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_frame = snapshot.resolve_default_frame();
    let frame = payload
        .frame_id
        .map_or(default_frame, thalos_core::spatial::frame::FrameId::Id);
    let target_pose = payload.target.to_pose(frame);

    let snapshot = state
        .services
        .scene
        .execute(Command::Motion(MotionCommands::PlanAndMoveL {
            frame,
            target_pose,
            max_velocity: payload.velocity,
            max_acceleration: payload.acceleration,
            time_step: None,
            cartesian_step: None,
        }))
        .await?;

    Ok(Json(to_api_response(&snapshot)))
}
