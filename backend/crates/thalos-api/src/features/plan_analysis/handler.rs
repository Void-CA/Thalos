//! Handler para el endpoint de análisis de planes.
//!
//! POST /api/v1/plan/analyze
//!
//! Analiza el plan activo del runtime y retorna métricas + recomendaciones.

use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_runtime::{PlanAnalysisService, RuntimeSnapshot};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::plan_analysis::dto::{
    PlanAnalysisRequest, PlanAnalysisResponse, RecommendationDto,
};

/// POST /api/v1/plan/analyze
///
/// Analiza la trayectoria del plan activo (o de un plan específico)
/// y retorna métricas de calidad, seguridad y recomendaciones.
pub async fn analyze_plan(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PlanAnalysisRequest>,
) -> ApiResult<PlanAnalysisResponse> {
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

    let result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None, // constraints opcionales
    )?;

    Ok(Json(PlanAnalysisResponse {
        trajectory_duration: result.analysis.metrics.trajectory_duration,
        waypoint_count: result.analysis.metrics.waypoint_count,
        avg_manipulability: result.analysis.metrics.avg_manipulability,
        min_manipulability: result.analysis.metrics.min_manipulability,
        near_singular_count: result.analysis.metrics.near_singular_count,
        singular_count: result.analysis.metrics.singular_count,
        min_collision_distance: result.analysis.metrics.min_collision_distance,
        has_collisions: result.analysis.metrics.has_collisions,
        constraint_violation_count: result.analysis.constraint_violations.len(),
        recommendations: result
            .recommendations
            .into_iter()
            .map(RecommendationDto::from)
            .collect(),
    }))
}
