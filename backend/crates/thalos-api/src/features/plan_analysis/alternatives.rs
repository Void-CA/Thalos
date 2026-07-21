//! Handler para generación de alternativas de plan.
//!
//! POST /api/v1/plan/analyze/alternatives
//!
//! Toma el plan activo, lo analiza, genera candidatos por perturbación
//! determinista, los evalúa con la función de costo y devuelve un ranking.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Serialize;

use thalos_core::collision::CollisionMatrix;
use thalos_collision::NaiveCollisionChecker;
use thalos_planning::{
    analysis::TrajectoryAnalyzer,
    evaluation::{
        AlternativeGenerator, CostFunction, PerturbationStrategy, PlanEvaluator,
    },
    motion::program::CompiledPlan,
};
use thalos_runtime::{
    comparison, ExecutionAnalyzer as RuntimeExecutionAnalyzer,
};

use crate::app::error::ApiError;
use crate::app::prelude::*;
use crate::app::state::AppState;

/// Una perturbación aplicada a un waypoint (respuesta API).
#[derive(Debug, Serialize)]
pub struct PerturbationDto {
    pub waypoint: usize,
    pub joint: usize,
    pub delta: f64,
}

/// Un candidato rankeado (respuesta API).
#[derive(Debug, Serialize)]
pub struct RankedAlternativeDto {
    pub rank: usize,
    pub source_waypoint: usize,
    pub perturbations: Vec<PerturbationDto>,
    pub score: f64,
    pub original_score: f64,
    /// Diferencia absoluta: original_score - score (positivo = mejora).
    pub delta_score: f64,
    /// Mejora porcentual: (original_score - score) / original_score * 100.
    pub improvement_percent: f64,
    pub improvements: Vec<String>,
    pub breakdown: Vec<MetricBreakdownDto>,
}

/// Desglose de métricas para un score.
#[derive(Debug, Serialize)]
pub struct MetricBreakdownDto {
    pub name: String,
    pub original: f64,
    pub candidate: f64,
}

/// Respuesta del endpoint de alternativas.
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

fn metric_name(key: &thalos_planning::evaluation::metrics::MetricKind) -> &'static str {
    use thalos_planning::evaluation::metrics::MetricKind;
    match key {
        MetricKind::PathLength => "path_length",
        MetricKind::Manipulability => "manipulability",
        MetricKind::JointMargin => "joint_margin",
        MetricKind::CollisionRisk => "collision_risk",
        MetricKind::Smoothness => "smoothness",
        MetricKind::OrientationChange => "orientation_change",
    }
}

/// POST /api/v1/plan/analyze/alternatives
pub async fn analyze_alternatives(
    State(state): State<Arc<AppState>>,
) -> ApiResult<AlternativesResponse> {
    let snapshot = state.services.scene.snapshot().await?;

    // Obtener la trayectoria del plan activo
    let trajectory = snapshot
        .active_plan
        .as_ref()
        .map(|p| &p.trajectory)
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan to analyze".to_string(),
            code: "no_active_plan".to_string(),
        })?;

    // 1. Construir analyzer completo para evaluar original y candidatos
    let checker = NaiveCollisionChecker;
    let matrix = CollisionMatrix::new();
    let analyzer = TrajectoryAnalyzer::new(&snapshot.chain, snapshot.active_tcp.as_ref())
        .with_collision_checker(&checker, &matrix);

    let original_analysis = analyzer.analyze(trajectory).map_err(|e| ApiError::Internal {
        message: e.to_string(),
    })?;

    let findings = &original_analysis.findings;
    let original_metrics = PlanEvaluator::compute_metrics(&original_analysis.waypoints);

    // 2. Construir CompiledPlan para el generador
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

    // 3. Generar alternativas
    let strategy = PerturbationStrategy::default_mvp();
    let candidates = AlternativeGenerator::generate(&compiled, findings, &strategy);

    if candidates.is_empty() {
        return Ok(Json(AlternativesResponse {
            original_score: 0.0,
            original_breakdown: vec![],
            alternatives: vec![],
            total_candidates: 0,
        }));
    }

    // 4. Evaluar y rankear candidatos con el analyzer completo
    let cost_function = CostFunction::defaults();
    let original_score = cost_function.score(&original_metrics);

    let ranked = AlternativeGenerator::rank_candidates(
        &analyzer,
        &original_metrics,
        candidates,
        &cost_function,
    )
    .map_err(|e| ApiError::Internal {
        message: e.to_string(),
    })?;

    // 5. Convertir a DTOs
    let original_breakdown: Vec<MetricBreakdownItem> = original_score
        .breakdown
        .iter()
        .map(|(kind, val)| MetricBreakdownItem {
            name: metric_name(kind).to_string(),
            value: *val,
        })
        .collect();

    let alternatives: Vec<RankedAlternativeDto> = ranked
        .into_iter()
        .map(|r| {
            let breakdown: Vec<MetricBreakdownDto> = r
                .score
                .breakdown
                .iter()
                .map(|(kind, val)| MetricBreakdownDto {
                    name: metric_name(kind).to_string(),
                    original: r.original_score.breakdown.get(kind).copied().unwrap_or(0.0),
                    candidate: *val,
                })
                .collect();

            let score = r.score.total;
            let original_score = r.original_score.total;
            let delta_score = original_score - score;
            let improvement_percent = if original_score > 0.0 {
                (delta_score / original_score) * 100.0
            } else {
                0.0
            };

            RankedAlternativeDto {
                rank: r.rank,
                source_waypoint: r.candidate.source_waypoint,
                perturbations: r
                    .candidate
                    .perturbations
                    .iter()
                    .map(|p| PerturbationDto {
                        waypoint: p.waypoint,
                        joint: p.joint,
                        delta: p.delta,
                    })
                    .collect(),
                score,
                original_score,
                delta_score,
                improvement_percent,
                improvements: r.improvements,
                breakdown,
            }
        })
        .collect();

    let total = alternatives.len();

    Ok(Json(AlternativesResponse {
        original_score: original_score.total,
        original_breakdown,
        alternatives,
        total_candidates: total,
    }))
}

/// POST /api/v1/plan/regenerate-from-execution/{session_id}
///
/// Toma una sesión ejecutada, compara plan vs ejecución, extrae execution findings
/// y los usa como ProblemRegions para generar nuevas alternativas.
pub async fn regenerate_from_execution(
    State(state): State<Arc<AppState>>,
    Path(sid): Path<u64>,
) -> ApiResult<AlternativesResponse> {
    // 1. Cargar traces de la sesión
    let motion_trace = state
        .services
        .sessions
        .get_trace(sid)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("MotionTrace for session {} not found", sid),
        })?;

    let exec_trace = state
        .services
        .sessions
        .get_execution_trace(sid)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("ExecutionTrace for session {} not found", sid),
        })?;

    let session = state
        .services
        .sessions
        .get(sid)
        .await
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Session {} not found", sid),
        })?;

    // 2. Comparar y analizar ejecución
    let comparison = comparison::compare(
        &motion_trace,
        &exec_trace,
        &session.plan_id,
        &sid.to_string(),
        &session.robot_name,
    );

    let exec_analyzer = RuntimeExecutionAnalyzer::new();
    let exec_findings = exec_analyzer.analyze(&comparison);

    if exec_findings.is_empty() {
        return Ok(Json(AlternativesResponse {
            original_score: 0.0,
            original_breakdown: vec![],
            alternatives: vec![],
            total_candidates: 0,
        }));
    }

    // 3. Reconstruir CompiledPlan desde MotionTrace
    let samples = motion_trace.samples();
    let trajectory_points: Vec<_> = samples
        .iter()
        .map(|s| thalos_core::trajectory::TrajectoryPoint::new(
            s.joints.clone(),
            s.timestamp.as_secs_f64(),
        ))
        .collect();

    let trajectory = thalos_core::trajectory::Trajectory::new(trajectory_points);
    let compiled = CompiledPlan {
        merged_trajectory: trajectory,
        segments: vec![],
        duration: comparison.plan_duration,
        waypoint_count: motion_trace.len(),
    };

    // 4. Generar alternativas desde execution findings
    let strategy = PerturbationStrategy::default_mvp();
    let candidates = AlternativeGenerator::generate(&compiled, &exec_findings, &strategy);

    if candidates.is_empty() {
        return Ok(Json(AlternativesResponse {
            original_score: 0.0,
            original_breakdown: vec![],
            alternatives: vec![],
            total_candidates: 0,
        }));
    }

    // 5. Evaluar y rankear (usar métricas desde joints, sin TrajectoryAnalyzer
    //    porque no tenemos acceso al chain en este contexto)
    let cost_function = CostFunction::defaults();
    let original_metrics = PlanEvaluator::compute_metrics_from_joints(&compiled.merged_trajectory);
    let original_score = cost_function.score(&original_metrics);

    let mut scored: Vec<(_, _)> = candidates
        .into_iter()
        .map(|c| {
            let metrics = PlanEvaluator::compute_metrics_from_joints(&c.plan.merged_trajectory);
            let score = cost_function.score(&metrics);
            (c, score)
        })
        .collect();

    scored.sort_by(|a, b| a.1.total.partial_cmp(&b.1.total).unwrap_or(std::cmp::Ordering::Equal));

    // 6. Convertir a DTOs
    let original_breakdown: Vec<MetricBreakdownItem> = original_score
        .breakdown
        .iter()
        .map(|(kind, val)| MetricBreakdownItem {
            name: metric_name(kind).to_string(),
            value: *val,
        })
        .collect();

    let alternatives: Vec<RankedAlternativeDto> = scored
        .into_iter()
        .enumerate()
        .map(|(rank, (candidate, score))| {
            let improvements: Vec<String> = score
                .breakdown
                .iter()
                .filter_map(|(kind, val)| {
                    let orig = original_score.breakdown.get(kind).copied().unwrap_or(0.0);
                    let diff = orig - val;
                    if diff.abs() > 0.01 {
                        let label = match kind {
                            thalos_planning::evaluation::metrics::MetricKind::PathLength => "path length",
                            thalos_planning::evaluation::metrics::MetricKind::Manipulability => "manipulability",
                            thalos_planning::evaluation::metrics::MetricKind::JointMargin => "joint margin",
                            thalos_planning::evaluation::metrics::MetricKind::CollisionRisk => "collision risk",
                            thalos_planning::evaluation::metrics::MetricKind::Smoothness => "smoothness",
                            thalos_planning::evaluation::metrics::MetricKind::OrientationChange => "orientation change",
                        };
                        Some(if diff > 0.0 {
                            format!("+{}% better {}", (diff * 100.0).round(), label)
                        } else {
                            format!("{}% worse {}", (diff.abs() * 100.0).round(), label)
                        })
                    } else {
                        None
                    }
                })
                .collect();

            let breakdown: Vec<MetricBreakdownDto> = score
                .breakdown
                .iter()
                .map(|(kind, val)| MetricBreakdownDto {
                    name: metric_name(kind).to_string(),
                    original: original_score.breakdown.get(kind).copied().unwrap_or(0.0),
                    candidate: *val,
                })
                .collect();

            RankedAlternativeDto {
                rank: rank + 1,
                source_waypoint: candidate.source_waypoint,
                perturbations: candidate
                    .perturbations
                    .iter()
                    .map(|p| PerturbationDto {
                        waypoint: p.waypoint,
                        joint: p.joint,
                        delta: p.delta,
                    })
                    .collect(),
                score: score.total,
                original_score: original_score.total,
                delta_score: original_score.total - score.total,
                improvement_percent: if original_score.total > 0.0 {
                    ((original_score.total - score.total) / original_score.total) * 100.0
                } else {
                    0.0
                },
                improvements,
                breakdown,
            }
        })
        .collect();

    let total = alternatives.len();
    Ok(Json(AlternativesResponse {
        original_score: original_score.total,
        original_breakdown,
        alternatives,
        total_candidates: total,
    }))
}
