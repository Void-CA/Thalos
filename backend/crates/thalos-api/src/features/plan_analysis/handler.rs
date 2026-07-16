//! Handler para el endpoint de análisis de planes.
//!
//! POST /api/v1/plan/analyze
//!
//! Analiza el plan activo del runtime y retorna
//! summary + metrics + findings + recommendations.

use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_runtime::{PlanAnalysisService};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::plan_analysis::dto::{
    FindingDto, MetricsDto, PlanAnalysisRequest, PlanAnalysisResponse,
    RecommendationDto, SummaryDto,
};

/// POST /api/v1/plan/analyze
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

    let metrics = &result.analysis.metrics;
    let findings = &result.findings;

    Ok(Json(PlanAnalysisResponse {
        summary: SummaryDto::from_analysis(
            findings,
            metrics.has_collisions,
            metrics.avg_manipulability,
            metrics.singular_count,
        ),
        metrics: MetricsDto {
            duration: metrics.trajectory_duration,
            waypoint_count: metrics.waypoint_count,
            average_manipulability: metrics.avg_manipulability,
            near_singular_count: metrics.near_singular_count,
            singular_count: metrics.singular_count,
            min_collision_distance: metrics.min_collision_distance,
            has_collisions: metrics.has_collisions,
        },
        findings: findings.iter().map(FindingDto::from).collect(),
        recommendations: result
            .recommendations
            .into_iter()
            .map(RecommendationDto::from)
            .collect(),
    }))
}
