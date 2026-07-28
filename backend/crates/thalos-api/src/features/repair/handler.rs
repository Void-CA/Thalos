use std::sync::Arc;

use axum::{Json, extract::State};

use thalos_core::kinematics::{forward::ForwardKinematics, inverse::JacobianTransposeSolver};
use thalos_math::Vector3;
use thalos_planning::{
    analysis::region::{RegionDetector, RegionDetectorConfig},
    repair::{
        context::RepairContext,
        domain::RepairStrategy,
        planner::RepairPlanner,
        strategies::{LiftTcpStrategy, RotateToolStrategy, SplitSegment},
    },
};
use thalos_runtime::{PlanAnalysisService, RuntimeSnapshot};

use crate::app::{error::ApiError, prelude::*, state::AppState};
use crate::features::repair::dto::*;

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

/// POST /api/v1/plan/repair/options
pub async fn repair_options(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RepairOptionsResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let trajectory = snapshot
        .active_plan
        .as_ref()
        .map(|p| &p.trajectory)
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan".to_string(),
            code: "no_active_plan".to_string(),
        })?;

    let result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None,
    )?;

    let detector = RegionDetector::new(RegionDetectorConfig::default());
    let report = detector.detect(&result.findings);

    let strategies: Vec<Box<dyn RepairStrategy>> = vec![
        Box::new(LiftTcpStrategy::new(Vector3::new(0.0, 0.0, 0.01))),
        Box::new(RotateToolStrategy::new(0.05)),
        Box::new(SplitSegment::new(2)),
    ];
    let planner = RepairPlanner::new(strategies);

    let segments = snapshot
        .active_plan
        .as_ref()
        .and_then(|p| p.segments.clone())
        .unwrap_or_default();
    let compiled = thalos_planning::motion::program::CompiledPlan {
        merged_trajectory: trajectory.clone(),
        segments,
        duration: trajectory.duration(),
        waypoint_count: trajectory.waypoints().len(),
    };

    let ctx = build_repair_context(&snapshot);
    let plans = planner.plan(&compiled, &report.problem_regions, &ctx);

    let mut repairs = Vec::new();
    for plan in plans {
        for candidate in &plan.candidates {
            let eval = candidate.evaluation.as_ref();
            repairs.push(RepairOptionDto {
                region_id: plan.region.id.0,
                strategy: candidate.strategy.name().to_string(),
                status: "available".to_string(),
                improvement: eval.map(|e| e.improvement).unwrap_or(0.0),
                metrics_before: eval.map(|e| MetricsSummary {
                    manipulability: e.metrics_before.manipulability.average,
                    smoothness: e.metrics_before.smoothness,
                }),
                metrics_after: eval.map(|e| MetricsSummary {
                    manipulability: e.metrics_after.manipulability.average,
                    smoothness: e.metrics_after.smoothness,
                }),
            });
        }
    }

    Ok(Json(RepairOptionsResponse { repairs }))
}

/// POST /api/v1/plan/repair/apply — redirigido a sesiones
pub async fn repair_apply(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<RepairApplyRequest>,
) -> ApiResult<RepairApplyResponse> {
    Ok(Json(RepairApplyResponse {
        plan_id: req.plan_id.unwrap_or_default(),
        status: "deprecated".to_string(),
        modified_range: None,
        metrics_delta: None,
        reason: Some("Use POST /repair/sessions/{id}/apply".to_string()),
    }))
}
