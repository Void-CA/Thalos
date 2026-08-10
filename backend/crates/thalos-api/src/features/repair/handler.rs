use std::sync::Arc;

use axum::{Json, extract::State};

use thalos_core::{
    analysis::RegionGrouper,
    analysis::observation::ArtifactRef,
    ids::MotionPlanId,
    kinematics::{forward::ForwardKinematics, inverse::JacobianTransposeSolver},
};
use thalos_math::Vector3;
use thalos_planning::repair::{
    context::RepairContext,
    domain::RepairStrategy,
    planner::RepairPlanner,
    strategies::{LiftTcpStrategy, RotateToolStrategy, SplitSegment},
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
    let active_plan = snapshot
        .active_plan
        .as_ref()
        .ok_or_else(|| ApiError::InvalidState {
            message: "No active plan".to_string(),
            code: "no_active_plan".to_string(),
        })?;
    let trajectory = &active_plan.trajectory;
    // I3: observaciones ancladas al MotionPlan analizado.
    let artifact = ArtifactRef::MotionPlan(MotionPlanId(active_plan.plan_id.clone()));

    let result = PlanAnalysisService::analyze_plan(
        &snapshot.chain,
        trajectory,
        snapshot.active_tcp.as_ref(),
        None,
        artifact,
    )?;

    // Regiones desde las observaciones del reporte canónico (dueño único:
    // RegionGrouper).
    let regions = RegionGrouper::default().group(&result.report.observations);

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
    let plans = planner.plan(&compiled, &regions, &ctx);

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
