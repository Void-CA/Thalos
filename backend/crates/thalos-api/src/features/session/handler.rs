use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::Value;

use thalos_runtime::{
    backends::{
        controller::RobotController,
        playback::interpolator::{Interpolator, LinearInterpolator, NearestSampleInterpolator},
        replay::ReplayBackend,
    },
    ExecutionSource, MotionTrace,
};

use crate::app::error::ApiError;
use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::scene::dto::responses::RuntimeStateResponse;
use crate::features::scene::handler::to_api_response;
use crate::features::session::dto::*;

/// Listar todas las sesiones.
pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Vec<SessionResponse>> {
    let sessions = state.services.sessions.list().await;
    let response: Vec<SessionResponse> = sessions.into_iter().map(|s| s.into()).collect();
    Ok(Json(response))
}

/// Obtener una sesión por ID.
pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> ApiResult<SessionResponse> {
    let session = state.services.sessions.get(id).await.ok_or_else(|| {
        ApiError::NotFound {
            message: format!("Session {} not found", id),
        }
    })?;
    Ok(Json(session.into()))
}

/// Obtener el trace de una sesión (JSON).
pub async fn get_trace(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let trace = state.services.sessions.get_trace(id).await.ok_or_else(|| {
        ApiError::NotFound {
            message: format!("Trace for session {} not found", id),
        }
    })?;
    let json = serde_json::to_value(&trace).map_err(|e| ApiError::Internal {
        message: e.to_string(),
    })?;
    Ok(Json(json))
}

/// Exportar trace como CSV (raw text, no JSON).
pub async fn export_trace_csv(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<(axum::http::StatusCode, String), ApiError> {
    let trace = state.services.sessions.get_trace(id).await.ok_or_else(|| {
        ApiError::NotFound {
            message: format!("Trace for session {} not found", id),
        }
    })?;
    Ok((
        axum::http::StatusCode::OK,
        trace.to_csv(),
    ))
}

/// Iniciar replay de una sesión.
pub async fn start_replay(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReplayRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let trace = state
        .services
        .sessions
        .get_trace(payload.session_id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Trace for session {} not found", payload.session_id),
        })?;

    let interpolator: Box<dyn Interpolator + Send + Sync> = match payload.interpolation.as_str() {
        "nearest" => Box::new(NearestSampleInterpolator::new()),
        _ => Box::new(LinearInterpolator::new()),
    };

    let replay = Arc::new(tokio::sync::RwLock::new(
        ReplayBackend::with_interpolator(trace, interpolator),
    )) as Arc<tokio::sync::RwLock<dyn RobotController + Send + Sync>>;

    state
        .services
        .manager
        .replace_controller(replay)
        .await
        .map_err(|e| ApiError::Internal {
            message: e.to_string(),
        })?;

    let snapshot = state.services.scene.snapshot().await.map_err(|e| {
        ApiError::Internal {
            message: e.to_string(),
        }
    })?;

    Ok(Json(to_api_response(&snapshot)))
}

/// Importar un trace desde JSON.
pub async fn import_trace(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ImportRequest>,
) -> ApiResult<SessionResponse> {
    let trace: MotionTrace = serde_json::from_str(&payload.trace_json).map_err(|e| {
        ApiError::Validation {
            message: format!("Invalid trace JSON: {}", e),
            code: "invalid_trace".into(),
        }
    })?;

    let session = state
        .services
        .sessions
        .import(
            ExecutionSource::Replay { session_id: 0 },
            trace,
            payload.robot_name,
        )
        .await;

    Ok(Json(session.into()))
}
