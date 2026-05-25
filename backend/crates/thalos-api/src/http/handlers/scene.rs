use std::sync::Arc;

use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use thalos_visual::SceneError;

use crate::app::{
    dto::{DiffRequest, FromFkRequest, ValidateRequest, ValidateResponse, ErrorResponse},
    state::AppState,
};

pub async fn get_scene(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.services.scene.build_scene(&[0.0, 0.0]) {
        Ok(scene) => Json(scene).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e.to_string() }),
        )
            .into_response(),
    }
}

pub async fn from_fk(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<FromFkRequest>,
) -> impl IntoResponse {
    match state.services.scene.build_scene(&payload.joint_angles) {
        Ok(scene) => Json(scene).into_response(),
        Err(e) => {
            let status = api_error_status(&e);
            (status, Json(ErrorResponse { error: e.to_string() })).into_response()
        }
    }
}

pub async fn validate(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ValidateRequest>,
) -> impl IntoResponse {
    match state.services.scene.validate(&payload.scene) {
        Ok(_) => Json(ValidateResponse {
            valid: true,
            error: None,
        })
        .into_response(),
        Err(e) => {
            let status = api_error_status(&e);
            (
                status,
                Json(ValidateResponse {
                    valid: false,
                    error: Some(e.to_string()),
                }),
            )
                .into_response()
        }
    }
}

pub async fn diff(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DiffRequest>,
) -> impl IntoResponse {
    let result = state
        .services
        .scene
        .diff(&payload.old, &payload.new, payload.epsilon);
    Json(result).into_response()
}

fn api_error_status(e: &SceneError) -> axum::http::StatusCode {
    match e {
        SceneError::MissingWorld
        | SceneError::MissingFrame(_)
        | SceneError::DuplicateId { .. }
        | SceneError::BrokenTopology { .. }
        | SceneError::NonFiniteValue { .. }
        | SceneError::InvalidQuaternion { .. }
        | SceneError::OrphanLink { .. }
        | SceneError::TwistsMismatch { .. } => axum::http::StatusCode::UNPROCESSABLE_ENTITY,
    }
}
