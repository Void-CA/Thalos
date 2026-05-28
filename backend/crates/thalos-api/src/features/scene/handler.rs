use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_core::models::RobotModel;

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::robots::dto::RobotMetadataDto;
use crate::features::scene::dto::*;

pub async fn get_scene(
    State(state): State<Arc<AppState>>,
) -> ApiResult<SceneStateResponse> {
    let scene = state.services.scene.build_scene()?;

    Ok(Json(SceneStateResponse::new(scene.into())))
}

pub async fn set_joints(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SetJointsRequest>,
) -> ApiResult<SceneStateResponse> {
    state
        .services
        .scene
        .set_joints(payload.joint_angles);

    let scene = state.services.scene.build_scene()?;

    Ok(Json(SceneStateResponse::new(scene.into())))
}

pub async fn load_robot(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoadRobotRequest>,
) -> ApiResult<RobotMetadataDto> {
    let model = RobotModel::from_id(&payload.robot_id)?;

    state.services.scene.load_robot(model);

    Ok(Json(model.metadata().into()))
}

pub async fn validate(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ValidateRequest>,
) -> ApiResult<ValidateResponse> {
    let scene: thalos_visual::VisualScene = payload.scene.into();

    state.services.scene.validate(&scene)?;

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
