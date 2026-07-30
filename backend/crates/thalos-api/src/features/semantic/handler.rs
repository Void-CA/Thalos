use std::sync::Arc;

use axum::{Json, extract::State};

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

use crate::app::error::ApiError;
use crate::app::state::AppState;
use crate::features::semantic::{
    CompileMetadata, CompileResponse, RunResponse, SemanticCompileRequest, ValidationSummary,
};

/// Compile a semantic task into a MotionProgram.
pub async fn compile_semantic(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<CompileResponse>, ApiError> {
    let task = payload.task;
    let validation = validate(&task.program);
    if !validation.errors.is_empty() {
        let err_msgs: Vec<String> = validation.errors.iter()
            .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin)).collect();
        return Err(ApiError::Validation { message: err_msgs.join("; "), code: "semantic_validation_error".into() });
    }
    let warnings: Vec<String> = validation.warnings.iter()
        .map(|d| format!("[{:?}] {}", d.severity, d.message)).collect();

    let provider = task.scene.knowledge();
    let ctx = LoweringContext {
        provider: &provider,
        default_tool: None,
        default_profile: MotionProfile { max_velocity: 1.0, max_acceleration: 0.5, max_jerk: None },
    };
    let motion_program = SemanticLowering::lower(&task.program, &ctx)
        .map_err(|e| ApiError::Validation { message: format!("Semantic lowering failed: {e}"), code: "lowering_error".into() })?;
    let instruction_count = motion_program.instructions.len();

    Ok(Json(CompileResponse {
        status: "ok".to_string(),
        validation: ValidationSummary { errors: vec![], warnings },
        metadata: CompileMetadata { instruction_count },
        motion_program,
    }))
}

/// Extract flat waypoints from an ExecutionPlan.
fn extract_waypoints(plan: &ExecutionPlan) -> Vec<TrajectoryPoint> {
    let mut pts = Vec::new();
    let mut t = 0.0_f64;
    for seg in &plan.segments {
        match seg {
            ExecutionSegment::JointTrajectory { samples } => {
                for s in samples {
                    pts.push(TrajectoryPoint::new(s.joints.clone(), t + s.time.as_secs_f64()));
                }
                if let Some(last) = samples.last() { t += last.time.as_secs_f64(); }
            }
            ExecutionSegment::CartesianTrajectory { resolved, .. } => {
                for (i, j) in resolved.iter().enumerate() {
                    let ti = t + i as f64 * 0.01;
                    pts.push(TrajectoryPoint::new(j.clone(), ti));
                }
                t += resolved.len() as f64 * 0.01;
            }
            ExecutionSegment::Pause { duration } => { t += duration.as_secs_f64(); }
            ExecutionSegment::Output { .. } => {}
        }
    }
    pts
}

/// Compile, plan, and load a semantic task into the scene runtime for execution.
pub async fn run_semantic(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<RunResponse>, ApiError> {
    let task = payload.task;

    // 1. Validate
    let validation = validate(&task.program);
    if !validation.errors.is_empty() {
        let err_msgs: Vec<String> = validation.errors.iter()
            .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin)).collect();
        return Err(ApiError::Validation { message: err_msgs.join("; "), code: "semantic_validation_error".into() });
    }

    // 2. Lower
    let provider = task.scene.knowledge();
    let ctx = LoweringContext {
        provider: &provider,
        default_tool: None,
        default_profile: MotionProfile { max_velocity: 1.0, max_acceleration: 0.5, max_jerk: None },
    };
    let motion_program = SemanticLowering::lower(&task.program, &ctx)
        .map_err(|e| ApiError::Validation { message: format!("Semantic lowering failed: {e}"), code: "lowering_error".into() })?;

    // 3. Plan
    let planner = ScaraPlanner::new();
    let planning_ctx = PlanningCtx {
        initial_state: vec![0.0, 0.0, 0.0, 0.0],
        robot: RobotModel::Scara,
        interpolation: InterpolationConfig::default(),
    };
    let execution_plan = planner.plan(&motion_program, &planning_ctx)
        .map_err(|e| ApiError::Validation { message: format!("Motion planning failed: {e}"), code: "planning_error".into() })?;

    // 4. Build waypoints and load into runtime
    let waypoints = extract_waypoints(&execution_plan);
    let traj = Trajectory::new(waypoints);
    let compiled = CompiledPlan::new(traj, vec![]);

    let snapshot = state.services.scene.schedule_program(compiled).await
        .map_err(|e| ApiError::Internal { message: format!("Failed to schedule plan: {e}") })?;

    Ok(Json(crate::features::semantic::RunResponse {
        status: "ok".to_string(),
        segment_count: execution_plan.metadata.segment_count,
        duration_secs: execution_plan.metadata.total_duration.as_secs_f64(),
    }))
}
