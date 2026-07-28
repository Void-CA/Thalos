use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
};
use serde::Serialize;
use serde_json::Value;

use thalos_runtime::{
    ExecutionAnalyzer, ExecutionSource, ExecutionTrace, MotionTrace, TraceAnalyzer,
    backends::{
        controller::RobotController,
        playback::interpolator::{Interpolator, LinearInterpolator, NearestSampleInterpolator},
        replay::ReplayBackend,
    },
    comparison,
};

use thalos_planning::finding::Finding;

use crate::app::error::ApiError;
use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::scene::dto::responses::RuntimeStateResponse;
use crate::features::scene::handler::to_api_response;
use crate::features::session::dto::*;

/// Listar todas las sesiones.
pub async fn list_sessions(State(state): State<Arc<AppState>>) -> ApiResult<Vec<SessionResponse>> {
    let sessions = state.services.sessions.list().await;
    let response: Vec<SessionResponse> = sessions.into_iter().map(|s| s.into()).collect();
    Ok(Json(response))
}

/// Obtener una sesión por ID.
pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> ApiResult<SessionResponse> {
    let session = state
        .services
        .sessions
        .get(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Session {} not found", id),
        })?;
    Ok(Json(session.into()))
}

/// Obtener el trace original (MotionTrace) de una sesión.
pub async fn get_trace(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let trace = state
        .services
        .sessions
        .get_trace(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Trace for session {} not found", id),
        })?;
    let json = serde_json::to_value(&trace).map_err(|e| ApiError::Internal {
        message: e.to_string(),
    })?;
    Ok(Json(json))
}

/// Obtener el ExecutionTrace completo de una sesión.
pub async fn get_execution_trace(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let trace = state
        .services
        .sessions
        .get_execution_trace(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Execution trace for session {} not found", id),
        })?;
    let json = serde_json::to_value(&trace).map_err(|e| ApiError::Internal {
        message: e.to_string(),
    })?;
    Ok(Json(json))
}

/// Obtener estadísticas computadas de una sesión.
pub async fn get_session_statistics(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<thalos_runtime::telemetry::analyzer::ExecutionStatistics>, ApiError> {
    let trace = state
        .services
        .sessions
        .get_execution_trace(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Execution trace for session {} not found", id),
        })?;
    let stats = TraceAnalyzer::analyze(&trace);
    Ok(Json(stats))
}

/// Comparar plan (MotionTrace) con ejecución (ExecutionTrace) de una sesión.
pub async fn compare_plan_execution(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<comparison::PlanExecutionComparison>, ApiError> {
    // Obtener MotionTrace (plan) — usando el trace original de la sesión
    let motion_trace =
        state
            .services
            .sessions
            .get_trace(id)
            .await
            .ok_or_else(|| ApiError::NotFound {
                message: format!("MotionTrace for session {} not found", id),
            })?;

    // Obtener ExecutionTrace (ejecución)
    let exec_trace = state
        .services
        .sessions
        .get_execution_trace(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("ExecutionTrace for session {} not found", id),
        })?;

    let session = state
        .services
        .sessions
        .get(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Session {} not found", id),
        })?;

    let result = comparison::compare(
        &motion_trace,
        &exec_trace,
        &session.plan_id,
        &id.to_string(),
        &session.robot_name,
    );

    Ok(Json(result))
}

/// Resumen de una sesión con estadísticas calculadas del trace.
#[derive(Debug, Serialize)]
pub struct SessionSummary {
    pub session_id: u64,
    pub duration: f64,
    pub sample_count: usize,
    pub joint_count: usize,
    pub max_velocity: Vec<f64>,
    pub mean_velocity: Vec<f64>,
    pub path_length: f64,
    pub recording_source: String,
    pub status: String,
}

/// Obtener resumen estadístico de una sesión.
pub async fn get_session_summary(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<SessionSummary>, ApiError> {
    let (session, trace) = {
        let swt = state
            .services
            .sessions
            .get_with_trace(id)
            .await
            .ok_or_else(|| ApiError::NotFound {
                message: format!("Session {} not found", id),
            })?;
        (swt.session, swt.trace)
    };

    let sample_count = trace.as_ref().map(|t| t.len()).unwrap_or(0);
    let duration = session.duration;
    let joint_count = session.joint_count;

    let (max_velocity, mean_velocity, path_length) = if let Some(ref t) = trace {
        let samples = t.samples();
        let n = joint_count;

        // Max velocity per joint (from sample velocities)
        let max_vel: Vec<f64> = if samples.iter().any(|s| !s.velocities.is_empty()) {
            (0..n)
                .map(|j| {
                    samples
                        .iter()
                        .filter_map(|s| s.velocities.get(j).copied())
                        .fold(0.0f64, |a, b| a.max(b))
                })
                .collect()
        } else {
            // Estimate velocity from position deltas
            (0..n)
                .map(|j| {
                    samples
                        .windows(2)
                        .filter_map(|w| {
                            let dt = (w[1].timestamp.as_secs_f64() - w[0].timestamp.as_secs_f64())
                                .max(1e-6);
                            let dv = (w[1].joints[j] - w[0].joints[j]).abs();
                            Some(dv / dt)
                        })
                        .fold(0.0f64, |a, b| a.max(b))
                })
                .collect()
        };

        // Mean velocity
        let mean_vel: Vec<f64> = (0..n)
            .map(|j| {
                let total: f64 = samples
                    .windows(2)
                    .map(|w| {
                        let dt =
                            (w[1].timestamp.as_secs_f64() - w[0].timestamp.as_secs_f64()).max(1e-6);
                        (w[1].joints[j] - w[0].joints[j]).abs()
                    })
                    .sum();
                total / duration.max(1e-6)
            })
            .collect();

        // Path length (sum of Euclidean distances between consecutive joint configs)
        let path_len: f64 = samples
            .windows(2)
            .map(|w| {
                w[1].joints
                    .iter()
                    .zip(&w[0].joints)
                    .map(|(a, b)| (a - b).powi(2))
                    .sum::<f64>()
                    .sqrt()
            })
            .sum();

        (max_vel, mean_vel, path_len)
    } else {
        (vec![], vec![], 0.0)
    };

    Ok(Json(SessionSummary {
        session_id: session.id,
        duration,
        sample_count,
        joint_count,
        max_velocity,
        mean_velocity,
        path_length,
        recording_source: session.source.to_string(),
        status: format!("{:?}", session.status),
    }))
}

/// Exportar trace como CSV (raw text, no JSON).
pub async fn export_trace_csv(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<(axum::http::StatusCode, String), ApiError> {
    let trace = state
        .services
        .sessions
        .get_trace(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Trace for session {} not found", id),
        })?;
    Ok((axum::http::StatusCode::OK, trace.to_csv()))
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

    let replay = Arc::new(tokio::sync::RwLock::new(ReplayBackend::with_interpolator(
        trace,
        interpolator,
    ))) as Arc<tokio::sync::RwLock<dyn RobotController + Send + Sync>>;

    state
        .services
        .manager
        .replace_controller(replay)
        .await
        .map_err(|e| ApiError::Internal {
            message: e.to_string(),
        })?;

    let snapshot = state
        .services
        .scene
        .snapshot()
        .await
        .map_err(|e| ApiError::Internal {
            message: e.to_string(),
        })?;

    Ok(Json(to_api_response(&snapshot)))
}

/// Importar un trace desde JSON.
pub async fn import_trace(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ImportRequest>,
) -> ApiResult<SessionResponse> {
    let trace: MotionTrace =
        serde_json::from_str(&payload.trace_json).map_err(|e| ApiError::Validation {
            message: format!("Invalid trace JSON: {}", e),
            code: "invalid_trace".into(),
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

// ── GET /sessions/{id}/comparison ──

/// Respuesta combinada: métricas de comparación + hallazgos de ejecución.
#[derive(Debug, Serialize)]
pub struct SessionComparisonResponse {
    pub metrics: comparison::ComparisonMetrics,
    pub findings: Vec<Finding>,
    pub aligned_pair_count: usize,
}

/// Comparar plan con ejecución y devolver métricas + hallazgos.
pub async fn get_session_comparison(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<SessionComparisonResponse>, ApiError> {
    let motion_trace =
        state
            .services
            .sessions
            .get_trace(id)
            .await
            .ok_or_else(|| ApiError::NotFound {
                message: format!("MotionTrace for session {} not found", id),
            })?;

    let exec_trace = state
        .services
        .sessions
        .get_execution_trace(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("ExecutionTrace for session {} not found", id),
        })?;

    let session = state
        .services
        .sessions
        .get(id)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Session {} not found", id),
        })?;

    let comparison = comparison::compare(
        &motion_trace,
        &exec_trace,
        &session.plan_id,
        &id.to_string(),
        &session.robot_name,
    );

    let aligned_pair_count = comparison.alignment.pairs.len();
    let metrics = comparison.metrics.clone();

    let analyzer = ExecutionAnalyzer::new();
    let findings = analyzer.analyze(&comparison);

    Ok(Json(SessionComparisonResponse {
        metrics,
        findings,
        aligned_pair_count,
    }))
}
