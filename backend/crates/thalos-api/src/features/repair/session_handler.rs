use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use thalos_core::kinematics::{
    forward::ForwardKinematics,
    inverse::JacobianTransposeSolver,
};
use thalos_math::Vector3;
use thalos_planning::{
    analysis::{
        domain::{ProblemRegion, RegionId},
        region::{RegionDetector, RegionDetectorConfig},
    },
    motion::program::CompiledPlan,
    repair::{
        context::RepairContext,
        domain::{
            traits::RepairStrategy,
            types::{RepairCandidate, StrategyKind},
        },
        merger::PlanMerger,
        planner::RepairPlanner,
        session::{
            domain::{SessionId, RepairSessionStatus},
            service::RepairSessionService,
        },
        strategies::{LiftTcpStrategy, RotateToolStrategy, SplitSegment},
    },
};
use thalos_runtime::{PlanAnalysisService, RuntimeSnapshot};

use crate::app::{error::ApiError, prelude::*, state::AppState};
use crate::features::repair::dto::*;

/// Estrategias disponibles en el sistema.
fn default_strategies() -> Vec<Box<dyn RepairStrategy>> {
    vec![
        Box::new(LiftTcpStrategy::new(Vector3::new(0.0, 0.0, 0.01))), // 1cm Z offset
        Box::new(RotateToolStrategy::new(0.05)),                       // ~3° rotation
        Box::new(SplitSegment::new(2)),                                // 2 intermediate waypoints
    ]
}

/// Construye un RepairContext desde un snapshot del runtime.
fn build_repair_context(snapshot: &RuntimeSnapshot) -> RepairContext {
    let chain = Arc::new(snapshot.chain.clone());
    let tcp_frame = snapshot
        .active_tcp
        .as_ref()
        .map(|tcp| tcp.base_frame.clone())
        .unwrap_or_else(|| chain.end_effector().clone());
    let fk = ForwardKinematics::new((*chain).clone());
    let solver = JacobianTransposeSolver::new(fk, tcp_frame.clone(), 100, 1e-4, 0.3);
    RepairContext {
        chain: chain.clone(),
        tcp_frame,
        ik_solver: Arc::new(solver),
    }
}

/// Match a strategy string (as sent by frontend) to a StrategyKind.
fn match_strategy(input: &str) -> Option<StrategyKind> {
    let normalized = input.trim().to_lowercase().replace(' ', "-");
    match normalized.as_str() {
        s if s.contains("lift") || s.contains("tcp") || s.contains("height") => Some(StrategyKind::LiftTcp),
        s if s.contains("rotate") || s.contains("tool") || s.contains("angle") || s.contains("orient") => Some(StrategyKind::RotateTool),
        s if s.contains("split") || s.contains("segment") || s.contains("insert") || s.contains("waypoint") || s.contains("intermediate") => Some(StrategyKind::SplitSegment),
        s if s.contains("switch") || s.contains("ik") || s.contains("solver") => Some(StrategyKind::RotateTool), // RotateTool como fallback para "cambiar solver"
        s if s.contains("smooth") => Some(StrategyKind::RotateTool),
        s if s.contains("adjust") || s.contains("review") || s.contains("range") || s.contains("constraint") || s.contains("reduce") || s.contains("speed") || s.contains("accel") || s.contains("sample") || s.contains("rate") || s.contains("track") => {
            // Casos sin estrategia directa: mapear a SplitSegment (modificación de trayectoria genérica)
            Some(StrategyKind::SplitSegment)
        }
        s if s.contains("path") || s.contains("move") || s.contains("obstacle") => Some(StrategyKind::SplitSegment),
        // Catch-all: SplitSegment no requiere IK y siempre funciona
        _ => Some(StrategyKind::SplitSegment),
    }
}

/// Encuentra una estrategia registrada por su kind.
fn find_strategy(strategies: &[Box<dyn RepairStrategy>], kind: StrategyKind) -> Option<&Box<dyn RepairStrategy>> {
    strategies.iter().find(|s| s.kind() == kind)
}

/// Estado compartido del servicio de sesiones con todo lo necesario
/// para preview/apply reales.
pub struct SessionServiceState {
    pub service: Mutex<RepairSessionService>,
    /// Estrategias concretas disponibles (clonadas de `default_strategies`).
    pub strategies: Vec<Box<dyn RepairStrategy>>,
    pub last_preview: Mutex<Option<(SessionId, RegionId, StrategyKind, RepairCandidate)>>,
}

impl SessionServiceState {
    pub fn new() -> Self {
        Self {
            service: Mutex::new(RepairSessionService::new(default_strategies())),
            strategies: default_strategies(),
            last_preview: Mutex::new(None),
        }
    }
}

/// POST /repair/sessions
pub async fn create_session(
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, Json<CreateSessionResponse>), ApiError> {
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
    let session_id = SessionId(id);

    // Validar sesión
    {
        let svc = state.session_service.service.lock().unwrap();
        let session = svc.get_session(session_id).ok_or_else(|| ApiError::NotFound {
            message: "Session not found".into(),
        })?;
        if session.status != RepairSessionStatus::Active {
            return Err(ApiError::InvalidState {
                message: "Session is not active".into(),
                code: "session_inactive".into(),
            });
        }
    }

    // Obtener snapshot para construir contexto y detectar regiones
    let snapshot = state.services.scene.snapshot().await.map_err(|e| ApiError::Internal {
        message: e.to_string(),
    })?;

    let ctx = build_repair_context(&snapshot);

    // Detectar regiones desde el plan actual
    let trajectory = snapshot
        .active_plan
        .as_ref()
        .map(|p| &p.trajectory)
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan".into(),
            code: "no_active_plan".into(),
        })?;

    let analysis = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None,
    )?;

    let detector = RegionDetector::new(RegionDetectorConfig::default());
    let report = detector.detect(&analysis.findings);

    // Encontrar la región solicitada
    let region_id = RegionId(req.region_id);
    let region = report.problem_regions.iter().find(|r| r.id == region_id)
        // Fallback: buscar por waypoint_start si no hay match exacto
        .or_else(|| report.problem_regions.iter().find(|r| r.waypoint_range.start == req.region_id as usize))
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Region {} not found in analysis", req.region_id),
        })?;

    // Encontrar la estrategia
    let strategy_kind = match_strategy(&req.strategy).ok_or_else(|| ApiError::Validation {
        message: format!("Unknown strategy: {}", req.strategy),
        code: "unknown_strategy".into(),
    })?;

    let strategy = find_strategy(&state.session_service.strategies, strategy_kind)
        .ok_or_else(|| ApiError::Unsupported {
            message: format!("Strategy not available: {:?}", strategy_kind),
            code: "strategy_unavailable".into(),
        })?;

    // Obtener el working_plan de la sesión
    let working_plan = {
        let svc = state.session_service.service.lock().unwrap();
        let session = svc.get_session(session_id).ok_or_else(|| ApiError::NotFound {
            message: "Session not found".into(),
        })?;
        session.working_plan.clone()
    };

    // Generar candidato real
    let candidates = strategy.generate(&ctx, &working_plan, region);
    let candidate = candidates.into_iter().next().ok_or_else(|| ApiError::Internal {
        message: format!("Strategy {:?} generated no candidates for region {}", strategy_kind, req.region_id),
    })?;

    let eval = candidate.evaluation.as_ref().ok_or_else(|| ApiError::Internal {
        message: "Candidate has no evaluation".into(),
    })?;

    // Verificar continuidad
    let continuity_ok = PlanMerger::apply(&working_plan, &candidate.delta).is_ok();

    // Almacenar para apply
    {
        let mut last = state.session_service.last_preview.lock().unwrap();
        *last = Some((session_id, region_id, strategy_kind, candidate.clone()));
    }

    Ok(Json(PreviewResponse {
        candidate_id: 0,
        base_revision: 0,
        continuity_ok,
        improvement: eval.improvement,
    }))
}

/// POST /repair/sessions/{id}/apply
pub async fn apply_repair(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u64>,
    Json(_req): Json<ApplyRequest>,
) -> Result<Json<ApplyResponse>, ApiError> {
    let session_id = SessionId(id);

    // Recuperar el último preview
    let (sid, region_id, strategy_kind, candidate) = {
        let mut last = state.session_service.last_preview.lock().unwrap();
        last.take().ok_or_else(|| ApiError::InvalidState {
            message: "No preview available. Call preview first.".into(),
            code: "no_preview".into(),
        })?
    };

    if sid != session_id {
        return Err(ApiError::InvalidState {
            message: "Preview was for a different session".into(),
            code: "preview_mismatch".into(),
        });
    }

    let evaluation = candidate.evaluation.as_ref().ok_or_else(|| ApiError::Internal {
        message: "Candidate has no evaluation".into(),
    })?;

    let metrics_before = evaluation.metrics_before.clone();
    let metrics_after = evaluation.metrics_after.clone();

    let mut svc = state.session_service.service.lock().unwrap();
    let result = svc.apply(session_id, region_id, strategy_kind, candidate, metrics_before, metrics_after)
        .map_err(|e| ApiError::Internal {
            message: e.to_string(),
        })?;

    Ok(Json(ApplyResponse {
        new_revision: result.new_revision.0,
        status: "applied".into(),
        history_length: result.session.history.len(),
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
