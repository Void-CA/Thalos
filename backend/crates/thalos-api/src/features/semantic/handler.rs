use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};

use thalos_core::analysis::location::Location;
use thalos_core::analysis::observation::{Observation, Severity};
use thalos_core::{
    kinematics::{
        forward::ForwardKinematics, inverse::DampedLeastSquaresSolver, inverse::IKConfig,
    },
    motion::MotionProfile,
    robot::state::RobotState,
    spatial::frame::FrameRegistry,
};
use thalos_intelligence::semantic::SemanticExpert;
use thalos_planning::{
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
    },
    resolver::{MotionResolver, ResolutionError},
    timeline::TimelineScheduler,
};
use thalos_semantic::{
    lowering::{SemanticLowering, context::LoweringContext},
    validation::validate,
};

use crate::app::state::AppState;
use crate::features::semantic::{
    CompileMetadata, CompileResponse, SemanticCompileRequest, ValidationSummary,
};

/// Project a validation observation into a machine-readable error string.
///
/// The domain observation carries no message (spec I1) — the phenomenon is
/// the machine-readable `kind` (`{:?}` of the enum), the anchor is the
/// operation id. Human-readable copy belongs to renderers (cambio A).
fn validation_message(o: &Observation) -> String {
    let op = match &o.location {
        Location::Operation(id) => format!("{id}"),
        other => format!("{other:?}"),
    };
    format!("[{:?}] {:?} (op: {op})", o.severity, o.kind)
}

/// IK solver configuration for semantic compilation (spec `ik-config`).
///
/// Preserved site values (1000/1e-4/0.1) — unifying the TYPE across sites,
/// not the values. Value convergence is a separate follow-up decision.
const IK_CONFIG: IKConfig = IKConfig {
    max_iterations: 1000,
    tolerance: 1e-4,
    lambda: 0.1,
};

/// Default JOINT-space motion profile for the semantic planner (spec
/// `move-l-velocity-profile`): 1.0 rad/s, 0.5 rad/s² — the pre-change
/// default, consistent with the icebot URDF rotational velocity limits
/// (1.0/2.0 rad/s). MoveJ plans in RADIANS, so this is deliberately NOT the
/// cartesian default. Planner behavior defaults, NOT physical robot
/// properties — the URDF joint velocity/effort limits remain separate
/// actuator constraints enforced at the execution boundary.
const JOINT_PROFILE: MotionProfile = MotionProfile {
    max_velocity: 1.0,
    max_acceleration: 0.5,
    max_jerk: None,
};

/// Default CARTESIAN-space motion profile for the semantic planner (spec
/// `move-l-velocity-profile`): 0.1 m/s, 0.5 m/s² — the visible ~0.4s demo
/// descent for short MoveL moves. Used ONLY for MoveL instructions (MoveJ
/// uses [`JOINT_PROFILE`]). Planner behavior default, NOT a physical robot
/// property — the URDF joint velocity/effort limits remain separate actuator
/// constraints.
const CARTESIAN_PROFILE: MotionProfile = MotionProfile {
    max_velocity: 0.1,
    max_acceleration: 0.5,
    max_jerk: None,
};

/// Compile semantic task → ExecutionProgram.
pub async fn compile_semantic(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<SemanticCompileRequest>,
) -> Result<Json<CompileResponse>, (StatusCode, Json<serde_json::Value>)> {
    let task = payload.task;
    let observations = validate(&task.program);
    if observations.iter().any(|o| o.severity == Severity::Error) {
        let msgs: Vec<String> = observations
            .iter()
            .filter(|o| o.severity == Severity::Error)
            .map(validation_message)
            .collect();
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(
                serde_json::json!({"error": msgs.join("; "), "code": "semantic_validation_error"}),
            ),
        ));
    }
    // B-lite (semantic-expert): the expert is advisory (Info/Warning only),
    // chained into the warnings channel — the 422 Error gate stays
    // authoritative and untouched.
    let expert = SemanticExpert::analyze(&task.program);
    let warnings: Vec<String> = observations
        .iter()
        .chain(expert.iter())
        .filter(|o| o.severity != Severity::Error)
        .map(validation_message)
        .collect();
    let provider = task.scene.knowledge();
    let ctx = LoweringContext {
        provider: &provider,
        default_tool: None,
        default_profile: JOINT_PROFILE,
        default_cartesian_profile: Some(CARTESIAN_PROFILE),
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
/// The loaded chain (`RuntimeSnapshot.chain`) is injected from the scene
/// state (I1) and drives both the IK solver and the DOF validation at the
/// `MotionResolver` boundary.
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
    // ── Robot del scene (I1: single robot per compilation) ──
    // ADR-003 P1 — the loaded chain is the single source of kinematics. The
    // semantic path consumes `snapshot.chain` and derives DOF from
    // `chain.dof_count()`; it never rebuilds a chain from a `RobotModel`.
    // `SerialChain` is `Send + Sync` plain data, so cloning it inside the
    // sync block below is safe.
    let snapshot = state
        .services
        .scene
        .snapshot()
        .await
        .map_err(planning_error)?;
    let chain = snapshot.chain.clone();
    let initial_joints = snapshot.joints.clone();

    // ── Síncrono: validación, lowering, resolución, compilación, timeline ──
    let (
        duration_secs,
        segment_count,
        waypoints_json,
        event_count,
        warnings,
        compiled,
        runtime_program,
    ) = {
        let task = payload.task;
        let observations = validate(&task.program);
        if observations.iter().any(|o| o.severity == Severity::Error) {
            let msgs: Vec<String> = observations
                .iter()
                .filter(|o| o.severity == Severity::Error)
                .map(validation_message)
                .collect();
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(
                    serde_json::json!({"error": msgs.join("; "), "code": "semantic_validation_error"}),
                ),
            ));
        }
        // B-lite (semantic-expert): advisory observations (Info/Warning only)
        // ride into the additive `warnings` array — never an Error, so the
        // 422 gate and the execution path are untouched.
        let expert = SemanticExpert::analyze(&task.program);
        let warnings: Vec<String> = observations
            .iter()
            .chain(expert.iter())
            .filter(|o| o.severity != Severity::Error)
            .map(validation_message)
            .collect();
        let provider = task.scene.knowledge();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: None,
            default_profile: JOINT_PROFILE,
            default_cartesian_profile: Some(CARTESIAN_PROFILE),
        };
        let mp = SemanticLowering::lower(&task.program, &ctx).map_err(|e| {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": format!("{e}"), "code": "lowering_error"})),
            )
        })?;

        // Build the IK solver from the scene's loaded chain (pattern
        // recovered from the deleted scara.rs: `snapshot.chain` →
        // `ForwardKinematics` → `DampedLeastSquaresSolver`).
        let dof = chain.dof_count();
        let fk = ForwardKinematics::new(chain.clone());
        let ik_solver = DampedLeastSquaresSolver::from_config(fk, *chain.end_effector(), IK_CONFIG);

        // Frame registry for the frame names the semantic layer emits.
        let mut registry = FrameRegistry::new();
        registry.create("world");

        let resolver = MotionResolver::new(&ik_solver, &registry, &initial_joints, dof)
            .map_err(resolver_error)?;
        let resolution = resolver.resolve(&mp).map_err(resolver_error)?;

        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let current_state = RobotState::new(initial_joints.clone());
        let seg_ctx = build_seg_ctx(&snapshot, &chain, &current_state, &ik_solver);
        let compiled = compiler
            .compile(&resolution.planning, &seg_ctx)
            .map_err(planning_error)?;

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
            warnings,
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
        "warnings": warnings,
    })))
}

/// Map a resolver error to a 4xx HTTP response with a descriptive message.
///
/// `ResolutionError::DofMismatch` carries the distinct `dof_mismatch` code
/// so clients can distinguish a DOF contract violation from a generic
/// planning failure (spec: Error Handling). The response body carries only
/// the error — no partial `CompiledPlan` or `RuntimeProgram` is ever
/// returned.
fn resolver_error(e: ResolutionError) -> (StatusCode, Json<serde_json::Value>) {
    let code = match e {
        ResolutionError::DofMismatch { .. } => "dof_mismatch",
        _ => "planning_error",
    };
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(serde_json::json!({"error": format!("{e}"), "code": code})),
    )
}

/// Map a scene-read or compilation error to a 4xx HTTP response with a
/// descriptive message (spec: Error Handling). The response body carries
/// only the error — no partial `CompiledPlan` or `RuntimeProgram` is ever
/// returned.
fn planning_error(e: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(serde_json::json!({"error": format!("{e}"), "code": "planning_error"})),
    )
}

/// Build the segment planning context for the semantic compile path.
///
/// Design D3: honors `snapshot.active_tcp` when present so singularity and
/// manipulability analysis reference the active TCP (matching the preview
/// path). When `active_tcp` is `None`, behavior is unchanged — analysis runs
/// against the flange (`chain.end_effector`).
fn build_seg_ctx<'a>(
    snapshot: &'a thalos_runtime::RuntimeSnapshot,
    chain: &'a thalos_core::robot::serial_chain::SerialChain,
    current_state: &'a RobotState,
    ik_solver: &'a dyn thalos_core::kinematics::inverse::IKSolver,
) -> SegmentPlanningContext<'a> {
    SegmentPlanningContext {
        robot: chain,
        current_state,
        ik_solver,
        tcp: snapshot.active_tcp.as_ref(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::{
        kinematics::{
            forward::ForwardKinematics,
            inverse::{IKGoal, IKResult, IKSolver, IkError},
        },
        models::{RobotModel, RobotRegistry},
        robot::{state::RobotState, tool_frame::ToolFrame},
    };
    use thalos_runtime::RuntimeSnapshot;

    /// IK solver stub — never invoked by `build_seg_ctx`, only required to
    /// satisfy the `SegmentPlanningContext` contract.
    struct NoopIKSolver;

    impl IKSolver for NoopIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult::converged(q0.to_vec(), 1, 0.0, None))
        }
    }

    fn snapshot_with_tcp(active_tcp: Option<ToolFrame>) -> RuntimeSnapshot {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let joints = vec![0.0, 0.0];
        let fk_result = ForwardKinematics::new(chain.clone()).evaluate(&joints);
        RuntimeSnapshot {
            robot: Some(RobotModel::Planar2R),
            robot_source: None,
            robot_name: "test".into(),
            robot_id: "planar_2r".into(),
            joints_meta: vec![],
            joints,
            chain,
            fk_result,
            ik_result: None,
            active_plan: None,
            execution: None,
            active_tcp,
            generated_at: chrono::Utc::now(),
        }
    }

    // ── Spec tcp-resolved-pose R6: semantic context gated on active_tcp ──

    /// R6.1: `active_tcp` Some → `seg_ctx.tcp` Some (same TCP frame).
    #[test]
    fn seg_ctx_tcp_some_when_active_tcp_set() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let tcp = ToolFrame::identity(*chain.end_effector());
        let snapshot = snapshot_with_tcp(Some(tcp.clone()));
        let state = RobotState::zero(2);
        let ik = NoopIKSolver;

        let ctx = build_seg_ctx(&snapshot, &chain, &state, &ik);

        let resolved = ctx
            .tcp
            .expect("seg_ctx.tcp must be Some when active_tcp is set");
        assert_eq!(
            resolved.base_frame, tcp.base_frame,
            "seg_ctx.tcp must reference the active TCP frame"
        );
    }

    /// R6.2: `active_tcp` None → `seg_ctx.tcp` None (unchanged legacy behavior).
    #[test]
    fn seg_ctx_tcp_none_when_active_tcp_unset() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let snapshot = snapshot_with_tcp(None);
        let state = RobotState::zero(2);
        let ik = NoopIKSolver;

        let ctx = build_seg_ctx(&snapshot, &chain, &state, &ik);

        assert!(
            ctx.tcp.is_none(),
            "seg_ctx.tcp must be None when active_tcp is unset"
        );
    }
}
