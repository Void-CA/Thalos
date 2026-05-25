use std::sync::Arc;

use axum::{
    extract::State,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use thalos_visual::{SceneError, VisualScene};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/scene", get(get_scene))
        .route("/scene/from-fk", post(from_fk))
        .route("/scene/validate", post(validate))
        .route("/scene/diff", post(diff))
}

async fn get_scene(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.service.build_scene(&[0.0, 0.0]) {
        Ok(scene) => Json(scene).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct FromFkJointAngles {
    joint_angles: Vec<f64>,
}

async fn from_fk(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<FromFkJointAngles>,
) -> impl IntoResponse {
    match state.service.build_scene(&payload.joint_angles) {
        Ok(scene) => Json(scene).into_response(),
        Err(e) => {
            let status = api_error_status(&e);
            (status, e.to_string()).into_response()
        }
    }
}

#[derive(Deserialize)]
struct ValidateRequest {
    scene: VisualScene,
}

async fn validate(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ValidateRequest>,
) -> impl IntoResponse {
    match state.service.validate(&payload.scene) {
        Ok(_) => Json(serde_json::json!({"valid": true})).into_response(),
        Err(e) => {
            let status = api_error_status(&e);
            (status, Json(serde_json::json!({"valid": false, "error": e.to_string()}))).into_response()
        }
    }
}

#[derive(Deserialize)]
struct DiffRequest {
    old: VisualScene,
    new: VisualScene,
    #[serde(default = "default_epsilon")]
    epsilon: f64,
}

fn default_epsilon() -> f64 {
    1e-6
}

async fn diff(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DiffRequest>,
) -> impl IntoResponse {
    let result = state.service.diff(&payload.old, &payload.new, payload.epsilon);
    Json(result)
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
