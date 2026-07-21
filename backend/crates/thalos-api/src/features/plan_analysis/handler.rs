//! Handler para el endpoint de análisis de planes.
//!
//! POST /api/v1/plan/analyze
//!
//! Analiza el plan activo del runtime y retorna
//! summary + metrics + findings + recommendations + problem_regions.

use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_planning::analysis::region::{
    HealthScoringStrategy, RegionDetector, RegionDetectorConfig,
};
use thalos_runtime::{PlanAnalysisService};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::plan_analysis::dto::{
    ExplanationDto, FindingDto, MetricsDto, PlanAnalysisRequest, PlanAnalysisResponse,
    ProblemRegionDto, RecommendationDto, RegionMetricsDto, SummaryDto, WaypointAnalysisDto,
};

/// Mapper: ProblemRegion → ProblemRegionDto
mod mapper {
    use super::*;
    use thalos_planning::analysis::domain::ProblemRegion;

    pub fn to_problem_region_dto(region: &ProblemRegion) -> ProblemRegionDto {
        let metrics = region.metrics.as_ref().map(|m| RegionMetricsDto {
            waypoint_count: m.waypoint_count,
            average_value: m.average_value,
            min_value: m.min_value,
            max_value: m.max_value,
            error_count: m.error_count,
            warning_count: m.warning_count,
        });

        let explanation = region.explanation.as_ref().map(|e| ExplanationDto {
            cause: e.cause.clone(),
            consequence: e.consequence.clone(),
            recommended_strategies: e.recommended_strategies.clone(),
            confidence: e.confidence,
        }).unwrap_or(ExplanationDto {
            cause: String::new(),
            consequence: String::new(),
            recommended_strategies: vec![],
            confidence: 1.0,
        });

        ProblemRegionDto {
            id: region.id.0,
            kind: region.kind.name().to_string(),
            severity: format!("{:?}", region.severity).to_lowercase(),
            waypoint_start: region.waypoint_range.start,
            waypoint_end: region.waypoint_range.end.saturating_sub(1),
            waypoint_count: region.waypoint_range.len(),
            metrics,
            explanation,
            confidence: None,
            recommended_strategies: vec![],
        }
    }

    pub fn to_problem_regions(regions: &[ProblemRegion]) -> Vec<ProblemRegionDto> {
        regions.iter().map(to_problem_region_dto).collect()
    }
}

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

    // M8.1: Detectar regiones problemáticas
    let detector = RegionDetector::new(RegionDetectorConfig::default());
    let analysis_report = detector.detect(&result.findings);

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
        waypoints: result.analysis.waypoints.iter().map(WaypointAnalysisDto::from).collect(),
        findings: findings.iter().map(FindingDto::from).collect(),
        recommendations: result
            .recommendations
            .into_iter()
            .map(RecommendationDto::from)
            .collect(),
        problem_regions: mapper::to_problem_regions(&analysis_report.problem_regions),
        health_score: Some(analysis_report.health_score),
    }))
}
