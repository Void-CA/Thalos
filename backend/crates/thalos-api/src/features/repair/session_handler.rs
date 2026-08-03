use std::sync::{Arc, Mutex};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};

use thalos_core::{
    analysis::observation::ArtifactRef,
    analysis::region::RegionId,
    analysis::RegionGrouper,
    ids::MotionPlanId,
    kinematics::{forward::ForwardKinematics, inverse::JacobianTransposeSolver},
    trajectory::Trajectory,
};
use thalos_math::Vector3;
use thalos_planning::{
    TrajectoryOperator, // re-exported from thalos-optimization
    motion::program::CompiledPlan,
    optimizer::TrajectoryOptimizer,
    repair::{
        context::RepairContext,
        domain::{
            traits::RepairStrategy,
            types::{PlanDelta, RepairCandidate, RepairEvaluation, StrategyKind},
        },
        merger::PlanMerger,
        session::{
            domain::{RepairSessionStatus, SessionId},
            service::RepairSessionService,
        },
        strategies::{LiftTcpStrategy, RotateToolStrategy, SplitSegment},
    },
};
use thalos_runtime::{PlanAnalysisService, RuntimeSnapshot};

use crate::app::{error::ApiError, state::AppState};
use crate::features::repair::dto::*;

/// Estrategias disponibles en el sistema.
fn default_strategies() -> Vec<Box<dyn RepairStrategy>> {
    vec![
        Box::new(LiftTcpStrategy::new(Vector3::new(0.0, 0.0, 0.01))), // 1cm Z offset
        Box::new(RotateToolStrategy::new(0.05)),                      // ~3° rotation
        Box::new(SplitSegment::new(2)),                               // 2 intermediate waypoints
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
        s if s.contains("joint") || s.contains("center") || s.contains("centering") => {
            Some(StrategyKind::SplitSegment)
        } // mapped to SplitSegment for tracking; actual execution via TrajectoryOptimizer
        s if s.contains("lift") || s.contains("tcp") || s.contains("height") => {
            Some(StrategyKind::LiftTcp)
        }
        s if s.contains("rotate")
            || s.contains("tool")
            || s.contains("angle")
            || s.contains("orient") =>
        {
            Some(StrategyKind::RotateTool)
        }
        s if s.contains("split")
            || s.contains("segment")
            || s.contains("insert")
            || s.contains("waypoint")
            || s.contains("intermediate") =>
        {
            Some(StrategyKind::SplitSegment)
        }
        s if s.contains("switch") || s.contains("ik") || s.contains("solver") => {
            Some(StrategyKind::RotateTool)
        } // RotateTool como fallback para "cambiar solver"
        s if s.contains("smooth") => Some(StrategyKind::RotateTool),
        s if s.contains("adjust")
            || s.contains("review")
            || s.contains("range")
            || s.contains("constraint")
            || s.contains("reduce")
            || s.contains("speed")
            || s.contains("accel")
            || s.contains("sample")
            || s.contains("rate")
            || s.contains("track") =>
        {
            // Casos sin estrategia directa: mapear a SplitSegment (modificación de trayectoria genérica)
            Some(StrategyKind::SplitSegment)
        }
        s if s.contains("path") || s.contains("move") || s.contains("obstacle") => {
            Some(StrategyKind::SplitSegment)
        }
        // Catch-all: SplitSegment no requiere IK y siempre funciona
        _ => Some(StrategyKind::SplitSegment),
    }
}

/// Estado compartido del servicio de sesiones con todo lo necesario
/// para preview/apply reales.
pub struct SessionServiceState {
    pub service: Mutex<RepairSessionService>,
    /// Optimizador de trayectorias con operadores nativos.
    pub optimizer: TrajectoryOptimizer,
    pub last_preview: Mutex<Option<(SessionId, RegionId, StrategyKind, RepairCandidate)>>,
}

impl SessionServiceState {
    pub fn new() -> Self {
        // Crear el optimizador con JointCenteringOperator como operador nativo
        let operators: Vec<Box<dyn TrajectoryOperator>> =
            vec![Box::new(thalos_planning::JointCenteringOperator::new(
                thalos_planning::JointCenteringOperator::DEFAULT_FACTOR,
            ))];

        Self {
            service: Mutex::new(RepairSessionService::new(default_strategies())),
            optimizer: TrajectoryOptimizer::new(operators),
            last_preview: Mutex::new(None),
        }
    }
}

/// POST /repair/sessions
pub async fn create_session(
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, Json<CreateSessionResponse>), ApiError> {
    let snapshot = state
        .services
        .scene
        .snapshot()
        .await
        .map_err(|e| ApiError::Internal {
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
        let session = svc
            .get_session(session_id)
            .ok_or_else(|| ApiError::NotFound {
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
    let snapshot = state
        .services
        .scene
        .snapshot()
        .await
        .map_err(|e| ApiError::Internal {
            message: e.to_string(),
        })?;

    let ctx = build_repair_context(&snapshot);

    // Detectar regiones desde el plan actual
    let active_plan = snapshot
        .active_plan
        .as_ref()
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan".into(),
            code: "no_active_plan".into(),
        })?;
    let trajectory = &active_plan.trajectory;
    // I3: observaciones ancladas al MotionPlan analizado.
    let artifact = ArtifactRef::MotionPlan(MotionPlanId(active_plan.plan_id.clone()));

    let analysis = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        artifact,
    )?;

    // Regiones desde las observaciones del reporte canónico (dueño único:
    // RegionGrouper).
    let regions = RegionGrouper::default().group(&analysis.report.observations);

    // Encontrar la región solicitada
    let region_id = RegionId(req.region_id);
    let region = regions
        .iter()
        .find(|r| r.id == region_id)
        // Fallback: buscar por waypoint_start si no hay match exacto
        .or_else(|| {
            regions
                .iter()
                .find(|r| r.waypoint_range.start == req.region_id as usize)
        })
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Region {} not found in analysis", req.region_id),
        })?;

    // Obtener el working_plan de la sesión
    let working_plan = {
        let svc = state.session_service.service.lock().unwrap();
        let session = svc
            .get_session(session_id)
            .ok_or_else(|| ApiError::NotFound {
                message: "Session not found".into(),
            })?;
        session.working_plan.clone()
    };

    // Determinar la estrategia solicitada (para tracking en el preview)
    let strategy_kind = match_strategy(&req.strategy).ok_or_else(|| ApiError::Validation {
        message: format!("Unknown strategy: {}", req.strategy),
        code: "unknown_strategy".into(),
    })?;

    // Ejecutar optimización a través del TrajectoryOptimizer
    let report = state
        .session_service
        .optimizer
        .optimize(
            &snapshot.chain,
            trajectory,
            &regions,
            Some(ctx.ik_solver.clone()),
        )
        .map_err(|e| ApiError::Internal {
            message: format!("Optimization failed: {}", e),
        })?;

    // Encontrar el step correspondiente a la región solicitada
    let step = report
        .steps
        .iter()
        .find(|s| s.region_id == region_id)
        .ok_or_else(|| ApiError::Internal {
            message: format!("No optimization step produced for region {}", req.region_id),
        })?;

    // Extraer la trayectoria optimizada para el rango de la región
    let final_traj = report
        .final_trajectory
        .as_ref()
        .ok_or_else(|| ApiError::Internal {
            message: "Optimization produced no final trajectory".into(),
        })?;

    // Crear delta que reemplaza el rango de waypoints de la región
    let range = region.waypoint_range.clone();
    let replacement_waypoints: Vec<_> = final_traj.waypoints()[range.clone()].to_vec();
    let replacement = Trajectory::new(replacement_waypoints);

    let delta =
        PlanDelta::new(region_id, range.clone(), replacement).map_err(|e| ApiError::Internal {
            message: format!("Failed to build plan delta: {}", e),
        })?;

    // Crear candidato con evaluación básica (métricas no disponibles sin re-analizar)
    use thalos_planning::evaluation::metrics::PlanMetrics as P;
    use thalos_planning::evaluation::metrics::{
        CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics,
    };
    let default_metrics = P {
        length: trajectory.duration(),
        waypoint_count: trajectory.len(),
        manipulability: ManipulabilityMetrics {
            min: 0.0,
            average: 0.0,
            near_singular_count: 0,
            singular_count: 0,
        },
        joint_safety: JointSafetyMetrics {
            min_margin: 1.0,
            avg_max_utilization: 0.0,
            violation_count: 0,
        },
        collision: CollisionMetrics {
            min_distance: f64::MAX,
            collision_count: 0,
            near_miss_count: 0,
        },
        smoothness: 0.0,
        orientation_change: 0.0,
    };
    let eval = RepairEvaluation {
        metrics_before: default_metrics.clone(),
        metrics_after: default_metrics,
        score_delta: step.improvement as f64,
        improvement: step.improvement as f64,
    };
    let candidate = RepairCandidate::new(strategy_kind, delta).with_evaluation(eval);

    // Verificar continuidad
    let continuity_ok = PlanMerger::apply(&working_plan, &candidate.delta).is_ok();

    // Almacenar para apply
    {
        let mut last = state.session_service.last_preview.lock().unwrap();
        *last = Some((session_id, region_id, strategy_kind, candidate.clone()));
    }

    let improvement = step.improvement as f64;

    Ok(Json(PreviewResponse {
        candidate_id: 0,
        base_revision: 0,
        continuity_ok,
        improvement,
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

    let evaluation = candidate
        .evaluation
        .as_ref()
        .ok_or_else(|| ApiError::Internal {
            message: "Candidate has no evaluation".into(),
        })?;

    let metrics_before = evaluation.metrics_before.clone();
    let metrics_after = evaluation.metrics_after.clone();

    let mut svc = state.session_service.service.lock().unwrap();
    let result = svc
        .apply(
            session_id,
            region_id,
            strategy_kind,
            candidate,
            metrics_before,
            metrics_after,
        )
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
        history_length: svc
            .get_session(session_id)
            .map(|s| s.history.len())
            .unwrap_or(0),
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
