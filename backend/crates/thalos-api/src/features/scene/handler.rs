use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_runtime::Command;

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::scene::dto::*;

pub async fn get_scene(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot()?;
    Ok(Json(snapshot.into()))
}

pub async fn set_joints(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SetJointsRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .execute(Command::SetJoints(payload.joint_angles))?;
    Ok(Json(snapshot.into()))
}

pub async fn load_robot(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoadRobotRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .execute(Command::LoadRobot(payload.robot_id))?;
    Ok(Json(snapshot.into()))
}

pub async fn validate(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ValidateRequest>,
) -> ApiResult<ValidateResponse> {
    let scene: thalos_visual::VisualScene = payload.scene.into();

    state.services.scene.validate_scene(&scene)?;

    Ok(Json(ValidateResponse {
        valid: true,
        error: None,
    }))
}

pub async fn diff(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DiffRequest>,
) -> ApiResult<SceneDiffDto> {
    let old: thalos_visual::VisualScene = payload.old.into();
    let new: thalos_visual::VisualScene = payload.new.into();

    let result = state
        .services
        .scene
        .diff(&old, &new, payload.epsilon);

    Ok(Json(result.into()))
}
