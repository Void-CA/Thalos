use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};

use serde::Serialize;
use thalos_core::{
    kinematics::{forward::ForwardKinematics, inverse::DampedLeastSquaresSolver},
    models::RobotRegistry,
    motion::MotionProfile,
    robot::state::RobotState,
    spatial::frame::FrameRegistry,
    trajectory::TrajectoryPoint,
};
use thalos_planning::{
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
        program::CompiledPlan,
    },
    resolver::MotionResolver,
    timeline::TimelineScheduler,
};
use thalos_semantic::{
    lowering::{SemanticLowering, context::LoweringContext},
    validation::validate,
};
use tracing_subscriber::field::debug;

use crate::app::state::AppState;
use crate::features::semantic::{
    CompileMetadata, CompileResponse, SemanticCompileRequest, ValidationSummary,
};

/// Compile semantic task → ExecutionProgram.
pub async fn compile_semantic(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<CompileResponse>, (StatusCode, Json<serde_json::Value>)> {
    let task = payload.task;
    let validation = validate(&task.program);
    if !validation.errors.is_empty() {
        let msgs: Vec<String> = validation
            .errors
            .iter()
            .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin))
            .collect();
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(
                serde_json::json!({"error": msgs.join("; "), "code": "semantic_validation_error"}),
            ),
        ));
    }
    let warnings: Vec<String> = validation
        .warnings
        .iter()
        .map(|d| format!("[{:?}] {}", d.severity, d.message))
        .collect();
    let provider = task.scene.knowledge();
    let ctx = LoweringContext {
        provider: &provider,
        default_tool: None,
        default_profile: MotionProfile {
            max_velocity: 1.0,
            max_acceleration: 0.5,
            max_jerk: None,
        },
    };
    let mp = SemanticLowering::lower(&task.program, &ctx).map_err(|e| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({"error": format!("{e}"), "code": "lowering_error"})),
        )
    })?;
    Ok(Json(CompileResponse {
        status: "ok".into(),
        validation: ValidationSummary {
            errors: vec![],
            warnings,
        },
        metadata: CompileMetadata {
            instruction_count: mp.instructions.len(),
        },
        motion_program: mp,
    }))
}

/// Compile + plan + load into scene runtime for execution.
///
/// Canonical path (I4 — one consumer per IR):
///
/// ```text
/// SemanticLowering → ExecutionProgram → MotionResolver →
/// PlanningProgram + RuntimeProgram → PlanCompiler → CompiledPlan
/// ```
///
/// The `RobotModel` is injected from the scene state (I1) and drives both
/// the IK solver and the DOF validation at the `MotionResolver` boundary.
/// The `RuntimeProgram` is produced but not yet scheduled — runtime event
/// dispatch arrives with the at_time post-pass (PR 3).
///
/// El bloque síncrono (lowering + planning) queda aislado para que
/// las referencias no-Send (`dyn KnowledgeProvider`) mueran antes
/// del `.await` de schedule_program.
pub async fn run_semantic(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // ── Robot del scene (I1: un solo robot por compilación) ──
    let robot_model = state.services.scene.robot_model().await;
    let initial_joints = state.services.scene.initial_joints().await;

    // ── Síncrono: validación, lowering, resolución, compilación, timeline ──
    let (duration_secs, segment_count, waypoints_json, event_count, compiled, runtime_program) = {
        let task = payload.task;
        let validation = validate(&task.program);
        if !validation.errors.is_empty() {
            let msgs: Vec<String> = validation
                .errors
                .iter()
                .map(|d| format!("[{:?}] {} (op: {:?})", d.severity, d.message, d.origin))
                .collect();
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(
                    serde_json::json!({"error": msgs.join("; "), "code": "semantic_validation_error"}),
                ),
            ));
        }
        let provider = task.scene.knowledge();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: None,
            default_profile: MotionProfile {
                max_velocity: 1.0,
                max_acceleration: 0.5,
                max_jerk: None,
            },
        };
        let mp = SemanticLowering::lower(&task.program, &ctx).map_err(|e| {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": format!("{e}"), "code": "lowering_error"})),
            )
        })?;

        // Build the IK solver from the scene's RobotModel (pattern recovered
        // from the deleted scara.rs: `RobotRegistry::create_default` →
        // `ForwardKinematics` → `DampedLeastSquaresSolver`).
        let chain = RobotRegistry::create_default(robot_model);
        let fk = ForwardKinematics::new(chain.clone());
        let ik_solver = DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 1000, 1e-4, 0.1);

        // Frame registry for the frame names the semantic layer emits.
        let mut registry = FrameRegistry::new();
        registry.create("world");

        let dof = robot_model.metadata().dof;
        let resolver =
            MotionResolver::new(&ik_solver, &registry, &initial_joints, dof).map_err(|e| {
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(serde_json::json!({"error": format!("{e}"), "code": "planning_error"})),
                )
            })?;
        let resolution = resolver.resolve(&mp).map_err(|e| {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": format!("{e}"), "code": "planning_error"})),
            )
        })?;

        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let current_state = RobotState::new(initial_joints.clone());
        let seg_ctx = SegmentPlanningContext {
            robot: &chain,
            current_state: &current_state,
            ik_solver: &ik_solver,
            tcp: None,
        };
        let compiled = compiler
            .compile(&resolution.planning, &seg_ctx)
            .map_err(|e| {
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(serde_json::json!({"error": format!("{e}"), "code": "planning_error"})),
                )
            })?;

        // TimelineScheduler: logical events → temporal events (absolute
        // at_time aligned to the compiled trajectory). CompiledPlan owns
        // physical time; the scheduler is the formal logical→temporal step.
        let runtime_program = TimelineScheduler::new().schedule(&mp, &compiled, resolution.runtime);

        let wps_json: Vec<serde_json::Value> = compiled
            .merged_trajectory
            .waypoints()
            .iter()
            .map(|p| serde_json::json!({"time_secs": p.timestamp(), "joints": p.joints()}))
            .collect();

        (
            compiled.duration,
            compiled.segments.len(),
            wps_json,
            runtime_program.events.len(),
            compiled,
            runtime_program,
        )
    };
    // provider, ctx, mp, resolver, ik_solver, chain, registry, task — todos dropped

    // ── Asíncrono: schedulea en runtime ──
    state
        .services
        .scene
        .schedule_program(compiled, runtime_program)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("{e}"), "code": "runtime_error"})),
            )
        })?;

    Ok(Json(serde_json::json!({
        "status": "ok",
        "segment_count": segment_count,
        "duration_secs": duration_secs,
        "waypoints": waypoints_json,
        "event_count": event_count,
    })))
}
