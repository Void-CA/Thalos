use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_visual::SceneDiff;

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::scene::dto::*;

pub async fn get_scene(
    State(state): State<Arc<AppState>>,
) -> ApiResult<SceneResponse> {
    let scene = state.services.scene.build_scene()?;

    Ok(Json(SceneResponse::new(scene)))
}


pub async fn set_joints(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SetJointsRequest>,
) -> ApiResult<SceneResponse> {
    state
        .services
        .scene
        .set_joints(payload.joint_angles);

    let scene = state.services.scene.build_scene()?;

    Ok(Json(SceneResponse::new(scene)))
}

pub async fn validate(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ValidateRequest>,
) -> ApiResult<ValidateResponse> {
    state.services.scene.validate(&payload.scene)?;
    Ok(Json(ValidateResponse {
        valid: true,
        error: None,
    }))
}

pub async fn diff(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DiffRequest>,
) -> ApiResult<SceneDiff> {
    let result = state
        .services
        .scene
        .diff(&payload.old, &payload.new, payload.epsilon);
    Ok(Json(result))
}
