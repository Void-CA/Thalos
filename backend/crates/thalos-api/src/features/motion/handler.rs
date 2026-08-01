use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use serde_json::json;
use thalos_core::{
    execution::program::ExecutionProgram,
    kinematics::{forward::ForwardKinematics, inverse::DampedLeastSquaresSolver},
    models::RobotRegistry,
    robot::state::RobotState,
    spatial::frame::FrameRegistry,
};
use thalos_planning::{
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
    },
    resolver::MotionResolver,
    timeline::TimelineScheduler,
};
use thalos_runtime::{Command, commands::motion::MotionCommands};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::motion::dto::*;
use crate::features::scene::dto::RuntimeStateResponse;
use crate::features::scene::handler::to_api_response;

/// Execute a joint-space motion command.
///
/// Plans a trapezoidal trajectory from the current joint
/// configuration to `target`, stores the active plan in the
/// runtime, and returns the full runtime state including the
/// trajectory visualisation.
pub async fn movej(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveJRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .execute(Command::Motion(MotionCommands::PlanAndMoveJ {
            target: payload.target.clone(),
            max_velocity: payload.velocity,
            max_acceleration: payload.acceleration,
            time_step: None,
        }))
        .await?;

    Ok(Json(to_api_response(&snapshot)))
}

/// Execute a cartesian / linear motion command.
///
/// Samples a linear path in task space, solves IK for each waypoint,
/// and produces a joint-space trajectory stored in the runtime.
/// Returns the full runtime state including the trajectory visualisation.
pub async fn movel(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveLRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_frame = snapshot.resolve_default_frame();
    let frame = payload
        .frame_id
        .map_or(default_frame, thalos_core::spatial::frame::FrameId::Id);
    let target_pose = payload.target.to_pose(frame);

    let snapshot = state
        .services
        .scene
        .execute(Command::Motion(MotionCommands::PlanAndMoveL {
            frame,
            target_pose,
            max_velocity: payload.velocity,
            max_acceleration: payload.acceleration,
            time_step: None,
            cartesian_step: None,
        }))
        .await?;

    Ok(Json(to_api_response(&snapshot)))
}

/// Plan an `ExecutionProgram` without executing it (preview semantics).
///
/// Canonical path — the same resolver → compiler → scheduler chain as the
/// semantic flow, without semantic lowering (no TaskDocument, no validate,
/// no SemanticLowering):
///
/// ```text
/// ExecutionProgram → MotionResolver →
/// PlanningProgram + RuntimeProgram → PlanCompiler → CompiledPlan
///                          └────────→ TimelineScheduler → RuntimeProgram (temporal)
/// ```
///
/// The `RobotModel` is injected from the scene state (I1) and drives both
/// the IK solver and the DOF validation at the `MotionResolver` boundary.
/// Plan-only: nothing is scheduled into the scene runtime, so no partial
/// state is ever modified on failure.
pub async fn plan(
    State(state): State<Arc<AppState>>,
    Json(program): Json<ExecutionProgram>,
) -> Result<Json<MotionPlanResponse>, (StatusCode, Json<serde_json::Value>)> {
    // ── Robot del scene (I1: un solo robot por compilación) ──
    let robot_model = state.services.scene.robot_model().await;
    let initial_joints = state.services.scene.initial_joints().await;

    // Build the IK solver from the scene's RobotModel — the same pattern as
    // the semantic handler (`RobotRegistry::create_default` →
    // `ForwardKinematics` → `DampedLeastSquaresSolver`).
    let chain = RobotRegistry::create_default(robot_model);
    let fk = ForwardKinematics::new(chain.clone());
    let ik_solver = DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 1000, 1e-4, 0.1);

    // Frame registry for the frame names the ExecutionProgram references.
    let mut registry = FrameRegistry::new();
    registry.create("world");

    let dof = robot_model.metadata().dof;
    let resolver =
        MotionResolver::new(&ik_solver, &registry, &initial_joints, dof).map_err(planning_error)?;
    let resolution = resolver.resolve(&program).map_err(planning_error)?;

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
        .map_err(planning_error)?;

    // TimelineScheduler: logical events → temporal events (absolute at_time
    // aligned to the compiled trajectory). CompiledPlan owns physical time.
    let runtime_program =
        TimelineScheduler::new().schedule(&program, &compiled, resolution.runtime);

    Ok(Json(MotionPlanResponse {
        compiled_plan: compiled,
        runtime_program,
    }))
}

/// Map a planning error to a 4xx HTTP response with a descriptive message
/// (spec: Error Handling). The response body carries only the error — no
/// partial `CompiledPlan` or `RuntimeProgram` is ever returned.
fn planning_error(e: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({"error": format!("{e}"), "code": "planning_error"})),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_planning::resolver::ResolutionError;

    /// DofMismatch (invariant I1) maps to 422 — the design-mandated status
    /// for a scene/robot DOF contract violation.
    #[test]
    fn dof_mismatch_maps_to_422() {
        let (status, Json(body)) = planning_error(ResolutionError::DofMismatch {
            expected: 2,
            actual: 4,
        });
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["code"], "planning_error");
        assert_eq!(
            body["error"],
            "DOF mismatch: robot has 2 DOF but initial_state has 4 joints"
        );
    }

    /// Other resolver errors (IK failure, unknown frame) map to 4xx with a
    /// descriptive message.
    #[test]
    fn resolver_errors_map_to_4xx_with_reason() {
        let (status, Json(body)) = planning_error(ResolutionError::IkFailed {
            instruction_index: 0,
            reason: "MaxIterations".into(),
        });
        assert!(status.is_client_error(), "resolver errors must be 4xx");
        assert_eq!(body["error"], "IK failed for instruction 1: MaxIterations");

        let (status, Json(body)) = planning_error(ResolutionError::UnknownFrame("base".into()));
        assert!(status.is_client_error(), "resolver errors must be 4xx");
        assert_eq!(body["error"], "unknown frame: base");
    }
}
