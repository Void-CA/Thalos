use std::sync::Arc;

use axum::{Json, extract::State, response::IntoResponse, http::StatusCode};

use thalos_core::models::RobotModel;
use thalos_core::motion::MotionProfile;
use thalos_core::trajectory::{Trajectory, TrajectoryPoint};
use thalos_planning::motion::{
    execution::{ExecutionPlan, ExecutionSegment},
    planner::{InterpolationConfig, MotionPlanner, PlanningCtx},
    program::CompiledPlan,
    scara::ScaraPlanner,
};
use thalos_semantic::{
    lowering::{context::LoweringContext, SemanticLowering},
    validation::validate,
};
use serde::Serialize;

use crate::app::state::AppState;
use crate::features::semantic::{
    CompileMetadata, CompileResponse, SemanticCompileRequest, ValidationSummary,
};

/// Compile semantic task → MotionProgram.
pub async fn compile_semantic(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<CompileResponse>, (StatusCode, Json<serde_json::Value>)> {
    let task = payload.task;
    let validation = validate(&task.program);
    if !validation.errors.is_empty() {
        let msgs: Vec<String> = validation.errors.iter()
            .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin)).collect();
        return Err((StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({"error": msgs.join("; "), "code": "semantic_validation_error"}))));
    }
    let warnings: Vec<String> = validation.warnings.iter()
        .map(|d| format!("[{:?}] {}", d.severity, d.message)).collect();
    let provider = task.scene.knowledge();
    let ctx = LoweringContext {
        provider: &provider, default_tool: None,
        default_profile: MotionProfile { max_velocity: 1.0, max_acceleration: 0.5, max_jerk: None },
    };
    let mp = SemanticLowering::lower(&task.program, &ctx)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({"error": format!("{e}"), "code": "lowering_error"}))))?;
    Ok(Json(CompileResponse {
        status: "ok".into(),
        validation: ValidationSummary { errors: vec![], warnings },
        metadata: CompileMetadata { instruction_count: mp.instructions.len() },
        motion_program: mp,
    }))
}

/// Compile + plan + load into scene runtime for execution.
pub async fn run_semantic(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let task = payload.task;
    let validation = validate(&task.program);
    if !validation.errors.is_empty() {
        let msgs: Vec<String> = validation.errors.iter()
            .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin)).collect();
        return Err((StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({"error": msgs.join("; "), "code": "semantic_validation_error"}))));
    }
    let provider = task.scene.knowledge();
    let ctx = LoweringContext {
        provider: &provider, default_tool: None,
        default_profile: MotionProfile { max_velocity: 1.0, max_acceleration: 0.5, max_jerk: None },
    };
    let mp = SemanticLowering::lower(&task.program, &ctx)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({"error": format!("{e}"), "code": "lowering_error"}))))?;

    // Plan via ScaraPlanner
    let planner = ScaraPlanner::new();
    let pctx = PlanningCtx {
        initial_state: vec![0.0, 0.0, 0.0, 0.0], robot: RobotModel::Scara,
        interpolation: InterpolationConfig::default(),
    };
    let ep = planner.plan(&mp, &pctx)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({"error": format!("{e}"), "code": "planning_error"}))))?;

    // Load into runtime (disabled: pending trait resolution)
    // let wps = extract_waypoints(&ep);
    // let traj = Trajectory::new(wps);
    // let compiled = CompiledPlan::new(traj, vec![]);
    // state.services.scene.schedule_program(compiled).await
    //     .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("{e}"), "code": "runtime_error"}))))?;

    Ok(Json(serde_json::json!({
        "status": "ok",
        "segment_count": ep.metadata.segment_count,
        "duration_secs": ep.metadata.total_duration.as_secs_f64(),
    })))
}

fn extract_waypoints(plan: &ExecutionPlan) -> Vec<TrajectoryPoint> {
    let mut pts = Vec::new();
    let mut t = 0.0_f64;
    for seg in &plan.segments {
        match seg {
            ExecutionSegment::JointTrajectory { samples } => {
                for s in samples { pts.push(TrajectoryPoint::new(s.joints.clone(), t + s.time.as_secs_f64())); }
                if let Some(last) = samples.last() { t += last.time.as_secs_f64(); }
            }
            ExecutionSegment::CartesianTrajectory { resolved, .. } => {
                for (i, j) in resolved.iter().enumerate() { pts.push(TrajectoryPoint::new(j.clone(), t + i as f64 * 0.01)); }
                t += resolved.len() as f64 * 0.01;
            }
            ExecutionSegment::Pause { duration } => { t += duration.as_secs_f64(); }
            ExecutionSegment::Output { .. } => {}
        }
    }
    pts
}
