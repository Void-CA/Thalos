//! Handler para generación de alternativas de plan (deprecated).
//!
//! POST /api/v1/plan/analyze/alternatives
//!
//! Endpoint legacy: internamente usa `RepairPlanner` y mapea los resultados
//! al formato `AlternativesResponse` para mantener compatibilidad.
//! El nuevo endpoint es POST /api/v1/plan/repair/options.

use std::sync::Arc;

use axum::{Json, extract::State};
use serde::Serialize;

use thalos_planning::{
    motion::program::CompiledPlan,
    repair::{
        domain::RepairStrategy,
        planner::RepairPlanner,
        strategies::{LiftTcpStrategy, RotateToolStrategy, SplitSegment},
    },
};
use thalos_runtime::{PlanAnalysisService, RuntimeSnapshot};

use crate::app::error::ApiError;
use crate::app::prelude::*;
use crate::app::state::AppState;

/// DTOs legacy (se mantienen idénticos para compatibilidad).
#[derive(Debug, Serialize)]
pub struct PerturbationDto {
    pub waypoint: usize,
    pub joint: usize,
    pub delta: f64,
}

#[derive(Debug, Serialize)]
pub struct RankedAlternativeDto {
    pub rank: usize,
    pub source_waypoint: usize,
    pub perturbations: Vec<PerturbationDto>,
    pub score: f64,
    pub original_score: f64,
    pub delta_score: f64,
    pub improvement_percent: f64,
    pub improvements: Vec<String>,
    pub breakdown: Vec<MetricBreakdownDto>,
}

#[derive(Debug, Serialize)]
pub struct MetricBreakdownDto {
    pub name: String,
    pub original: f64,
    pub candidate: f64,
}

#[derive(Debug, Serialize)]
pub struct AlternativesResponse {
    pub original_score: f64,
    pub original_breakdown: Vec<MetricBreakdownItem>,
    pub alternatives: Vec<RankedAlternativeDto>,
    pub total_candidates: usize,
}

#[derive(Debug, Serialize)]
pub struct MetricBreakdownItem {
    pub name: String,
    pub value: f64,
}

/// Constructor de repair context desde snapshot.
fn build_repair_context(
    snapshot: &RuntimeSnapshot,
) -> thalos_planning::repair::context::RepairContext {
    use std::sync::Arc as _Arc;
    let chain = _Arc::new(snapshot.chain.clone());
    let tcp_frame = snapshot
        .active_tcp
        .as_ref()
        .map(|tcp| tcp.base_frame.clone())
        .unwrap_or_else(|| chain.end_effector().clone());
    use thalos_core::kinematics::{forward::ForwardKinematics, inverse::JacobianTransposeSolver};
    let fk = ForwardKinematics::new((*chain).clone());
    let solver = JacobianTransposeSolver::new(fk, tcp_frame.clone(), 100, 1e-4, 0.3);
    thalos_planning::repair::context::RepairContext {
        chain: chain.clone(),
        tcp_frame,
        ik_solver: _Arc::new(solver),
    }
}

/// Mapper: RepairCandidate → RankedAlternativeDto (legacy format).
fn to_legacy_candidate(
    candidate: &thalos_planning::repair::domain::types::RepairCandidate,
    rank: usize,
) -> RankedAlternativeDto {
    let eval = candidate.evaluation.as_ref();
    let score = eval
        .map(|e| e.metrics_after.manipulability.average)
        .unwrap_or(0.0);
    let original_score = eval
        .map(|e| e.metrics_before.manipulability.average)
        .unwrap_or(0.0);
    let delta_score = original_score - score;
    let improvement_percent = if original_score > 0.0 {
        (delta_score / original_score) * 100.0
    } else {
        0.0
    };

    RankedAlternativeDto {
        rank,
        source_waypoint: candidate.delta.waypoint_range.start,
        perturbations: vec![], // legacy: ya no se reportan perturbaciones individuales
        score,
        original_score,
        delta_score,
        improvement_percent,
        improvements: vec![format!("Strategy: {}", candidate.strategy.name())],
        breakdown: vec![MetricBreakdownDto {
            name: candidate.strategy.name().to_string(),
            original: original_score,
            candidate: score,
        }],
    }
}

/// POST /api/v1/plan/analyze/alternatives (deprecated)
pub async fn analyze_alternatives(
    State(state): State<Arc<AppState>>,
) -> ApiResult<AlternativesResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    let trajectory = snapshot
        .active_plan
        .as_ref()
        .map(|p| &p.trajectory)
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan".to_string(),
            code: "no_active_plan".to_string(),
        })?;

    // Analizar plan
    let result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None,
    )?;
    let findings = &result.findings;

    // Detectar regiones (M8.1)
    let detector = thalos_planning::analysis::region::RegionDetector::new(Default::default());
    let report = detector.detect(findings);

    // RepairPlanner con estrategias
    let strategies: Vec<Box<dyn RepairStrategy>> = vec![
        Box::new(LiftTcpStrategy::new(thalos_math::Vector3::new(
            0.0, 0.0, 0.01,
        ))),
        Box::new(RotateToolStrategy::new(0.1)),
        Box::new(SplitSegment::new(2)),
    ];
    let planner = RepairPlanner::new(strategies);

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

    let ctx = build_repair_context(&snapshot);
    let plans = planner.plan(&compiled, &report.problem_regions, &ctx);

    // Mapear a formato legacy
    let mut rank = 1;
    let mut alternatives = Vec::new();
    for plan in &plans {
        for candidate in &plan.candidates {
            alternatives.push(to_legacy_candidate(candidate, rank));
            rank += 1;
        }
    }

    let total = alternatives.len();
    let original_score = alternatives
        .first()
        .map(|a| a.original_score)
        .unwrap_or(0.0);

    Ok(Json(AlternativesResponse {
        original_score,
        original_breakdown: vec![],
        alternatives,
        total_candidates: total,
    }))
}

/// POST /api/v1/plan/regenerate-from-execution/{session_id} (deprecated)
pub async fn regenerate_from_execution(
    State(state): State<Arc<AppState>>,
    _sid: axum::extract::Path<u64>,
) -> ApiResult<AlternativesResponse> {
    // Versión legacy: ignora session_id, delega a analyze_alternatives
    analyze_alternatives(State(state)).await
}
