use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use thalos_planning::repair::session::{
    domain::{SessionId, RepairSessionStatus},
    service::RepairSessionService,
};

use crate::app::{error::ApiError, prelude::*, state::AppState};
use crate::features::repair::dto::*;

/// Estado compartido del servicio de sesiones.
pub struct SessionServiceState {
    pub service: Mutex<RepairSessionService>,
}

impl SessionServiceState {
    pub fn new() -> Self {
        use thalos_planning::repair::{
            domain::RepairStrategy,
            strategies::{LiftTcpStrategy, RotateToolStrategy, SplitSegment},
        };
        use thalos_math::Vector3;

        let strategies: Vec<Box<dyn RepairStrategy>> = vec![
            Box::new(LiftTcpStrategy::new(Vector3::new(0.0, 0.0, 0.05))),
            Box::new(RotateToolStrategy::new(0.1)),
            Box::new(SplitSegment::new(2)),
        ];
        Self {
            service: Mutex::new(RepairSessionService::new(strategies)),
        }
    }
}

/// POST /repair/sessions
pub async fn create_session(
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, Json<CreateSessionResponse>), ApiError> {
    use thalos_planning::motion::program::CompiledPlan;
    use thalos_core::trajectory::Trajectory;

    let snapshot = state.services.scene.snapshot().await.map_err(|e| ApiError::Internal {
        message: e.to_string(),
    })?;

    let trajectory = snapshot
        .active_plan
        .as_ref()
        .map(|p| &p.trajectory)
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan".into(),
            code: "no_active_plan".into(),
        })?;

    let segments = snapshot
        .active_plan
        .as_ref()
        .and_then(|p| p.segments.clone())
        .unwrap_or_default();

    let compiled = CompiledPlan {
        merged_trajectory: trajectory.clone(),
        segments,
        duration: trajectory.duration(),
        waypoint_count: trajectory.waypoints().len(),
    };

    let mut svc = state.session_service.service.lock().unwrap();
    let session_id = svc.create_session(compiled);

    Ok((
        StatusCode::CREATED,
        Json(CreateSessionResponse {
            session_id: session_id.0,
        }),
    ))
}

/// POST /repair/sessions/{id}/preview
pub async fn preview_repair(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
    Json(req): Json<PreviewRequest>,
) -> Result<Json<PreviewResponse>, ApiError> {
    let svc = &state.session_service;
    let svc = svc.service.lock().unwrap();
    let session_id = SessionId(id);

    let session = svc.get_session(session_id).ok_or_else(|| ApiError::NotFound {
        message: "Session not found".into(),
    })?;

    // Preview validation
    if session.status != RepairSessionStatus::Active {
        return Err(ApiError::InvalidState {
            message: "Session is not active".into(),
            code: "session_inactive".into(),
        });
    }

    // Devolver información básica de la sesión
    Ok(Json(PreviewResponse {
        candidate_id: 0,
        base_revision: session.revision.0,
        continuity_ok: false,
        improvement: 0.0,
    }))
}

/// POST /repair/sessions/{id}/apply
pub async fn apply_repair(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
    Json(_req): Json<ApplyRequest>,
) -> Result<Json<ApplyResponse>, ApiError> {
    // TODO M8.4.4: candidate store integración completa
    // Por ahora devuelve el estado de la sesión sin aplicar
    let svc = state.session_service.service.lock().unwrap();
    let session_id = SessionId(id);

    let session = svc.get_session(session_id).ok_or_else(|| ApiError::NotFound {
        message: "Session not found".into(),
    })?;

    Ok(Json(ApplyResponse {
        new_revision: session.revision.0,
        status: "pending_candidate_store".into(),
        history_length: session.history.len(),
    }))
}

/// POST /repair/sessions/{id}/undo
pub async fn undo_repair(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<Json<ApplyResponse>, ApiError> {
    let mut svc = state.session_service.service.lock().unwrap();
    let session_id = SessionId(id);

    let new_revision = svc.undo(session_id).map_err(|e| ApiError::InvalidState {
        message: e.into(),
        code: "undo_failed".into(),
    })?;

    Ok(Json(ApplyResponse {
        new_revision: new_revision.0,
        status: "undo_success".into(),
        history_length: svc.get_session(session_id).map(|s| s.history.len()).unwrap_or(0),
    }))
}

/// DELETE /repair/sessions/{id}
pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
) -> Result<StatusCode, ApiError> {
    let mut svc = state.session_service.service.lock().unwrap();
    if svc.discard_session(SessionId(id)) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound {
            message: "Session not found".into(),
        })
    }
}
