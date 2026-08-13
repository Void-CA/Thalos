use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use serde_json::json;
use thalos_core::{
    execution::program::ExecutionProgram,
    kinematics::{forward::ForwardKinematics, inverse::DampedLeastSquaresSolver},
    robot::state::RobotState,
    spatial::frame::FrameRegistry,
};
use thalos_planning::{
    advisor::remediation::PhysicalEnvelope,
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
    },
    resolver::{MotionResolver, ResolutionError},
    timeline::TimelineScheduler,
};
use thalos_runtime::{Command, commands::motion::MotionCommands};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::motion::dto::*;
use crate::features::scene::dto::RuntimeStateResponse;
use crate::features::scene::handler::to_api_response;

/// ADR-2/ADR-5 (Correction A — non-negotiable): the API REJECTS a
/// movej/movel whose requested velocity or acceleration exceeds the planner's
/// `PhysicalEnvelope` — it NEVER silently clamps the request into the
/// envelope. "User requests X, Thalos executes Y" with Y ≠ X and a 200 is a
/// silent mutation of intent; false positive > false negative. The planner
/// MAY reparameterize with causal verification (a planner-side decision,
/// ADR-5), but the handler's contract is explicit rejection.
///
/// For `movel` the DTO values are cartesian (m/s, m/s²) and are compared
/// against the same joint-space ceilings per ADR-5's uniform reject contract —
/// a conservative bound; reparameterization remains the planner's job.
fn reject_envelope_exceeded(
    velocity: Option<f64>,
    acceleration: Option<f64>,
    envelope: PhysicalEnvelope,
) -> Result<(), ApiError> {
    if let Some(v) = velocity {
        if v > envelope.max_velocity {
            return Err(physical_envelope_exceeded("velocity", v, envelope.max_velocity));
        }
    }
    if let Some(a) = acceleration {
        if a > envelope.max_acceleration {
            return Err(physical_envelope_exceeded(
                "acceleration",
                a,
                envelope.max_acceleration,
            ));
        }
    }
    Ok(())
}

/// HTTP 422 `PhysicalEnvelopeExceeded` — the machine-readable code the
/// frontend branches on (spec `api_rejects_exceeding_velocity` /
/// `api_rejects_exceeding_acceleration`).
fn physical_envelope_exceeded(kind: &str, requested: f64, ceiling: f64) -> ApiError {
    ApiError::Validation {
        message: format!(
            "requested {kind} {requested} exceeds the planner's PhysicalEnvelope ceiling {ceiling}; reparameterize or lower the request"
        ),
        code: "PhysicalEnvelopeExceeded".into(),
    }
}

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
    // M3 (ADR-2/ADR-5): explicit envelope rejection BEFORE any planning. A
    // requested velocity/acceleration above the planner's PhysicalEnvelope is
    // rejected with HTTP 422 `PhysicalEnvelopeExceeded` — never silently
    // clamped (Correction A).
    let snapshot = state.services.scene.snapshot().await?;
    reject_envelope_exceeded(
        payload.velocity,
        payload.acceleration,
        PhysicalEnvelope::for_chain(&snapshot.chain),
    )?;

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

    // M3 (ADR-2/ADR-5): explicit envelope rejection BEFORE any planning —
    // never a silent clamp (Correction A). Same reject as movej; the planner
    // may reparameterize with causal verification, but that is NOT an API
    // clamp.
    reject_envelope_exceeded(
        payload.velocity,
        payload.acceleration,
        PhysicalEnvelope::for_chain(&snapshot.chain),
    )?;

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
/// The `RuntimeSnapshot` chain is injected from the scene state (I1) and
/// drives both the IK solver and the DOF validation at the `MotionResolver`
/// boundary. Plan-only: nothing is scheduled into the scene runtime, so no
/// partial state is ever modified on failure.
pub async fn plan(
    State(state): State<Arc<AppState>>,
    Json(program): Json<ExecutionProgram>,
) -> Result<Json<MotionPlanResponse>, (StatusCode, Json<serde_json::Value>)> {
    // ── Robot del scene (I1: single robot per compilation) ──
    // ADR-003 P1 — the loaded chain is the single source of kinematics. The
    // planner consumes `snapshot.chain` and derives DOF from
    // `chain.dof_count()`; it never rebuilds a chain from a `RobotModel`.
    let snapshot = state
        .services
        .scene
        .snapshot()
        .await
        .map_err(planning_error)?;
    let chain = snapshot.chain.clone();
    let initial_joints = snapshot.joints.clone();
    let dof = chain.dof_count();

    // Build the IK solver from the scene's loaded chain — the same pattern as
    // the semantic handler (`snapshot.chain` → `ForwardKinematics` →
    // `DampedLeastSquaresSolver`).
    let fk = ForwardKinematics::new(chain.clone());
    let ik_solver = DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 1000, 1e-4, 0.1);

    // Frame registry for the frame names the ExecutionProgram references.
    let mut registry = FrameRegistry::new();
    registry.create("world");

    let resolver =
        MotionResolver::new(&ik_solver, &registry, &initial_joints, dof).map_err(resolver_error)?;
    let resolution = resolver.resolve(&program).map_err(resolver_error)?;

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
        Json(json!({"error": format!("{e}"), "code": code})),
    )
}

/// Map a scene-read or compilation error to a 4xx HTTP response with a
/// descriptive message (spec: Error Handling). The response body carries
/// only the error — no partial `CompiledPlan` or `RuntimeProgram` is ever
/// returned.
fn planning_error(e: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({"error": format!("{e}"), "code": "planning_error"})),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use thalos_planning::advisor::remediation::{PhysicalEnvelope, SCARA_ENVELOPE};
    use thalos_planning::resolver::ResolutionError;

    /// DofMismatch (invariant I1) maps to 422 with the distinct
    /// `dof_mismatch` code (spec: Error Handling) so clients can tell a DOF
    /// contract violation apart from a generic planning failure.
    #[test]
    fn dof_mismatch_maps_to_422() {
        let (status, Json(body)) = resolver_error(ResolutionError::DofMismatch {
            expected: 2,
            actual: 4,
        });
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["code"], "dof_mismatch");
        assert_eq!(
            body["error"],
            "DOF mismatch: robot has 2 DOF but initial_state has 4 joints"
        );
    }

    /// Other resolver errors (IK failure, unknown frame) keep the generic
    /// `planning_error` code (spec: "IkFailed retains generic code").
    #[test]
    fn resolver_errors_keep_planning_error() {
        let (status, Json(body)) = resolver_error(ResolutionError::IkFailed {
            instruction_index: 0,
            reason: "MaxIterations".into(),
        });
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["code"], "planning_error");
        assert_eq!(body["error"], "IK failed for instruction 1: MaxIterations");

        let (status, Json(body)) = resolver_error(ResolutionError::UnknownFrame("base".into()));
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["code"], "planning_error");
        assert_eq!(body["error"], "unknown frame: base");
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

    // ── M3 (ADR-2/ADR-5): API REJECTS, never silently clamps ────────────────

    fn envelope_error_code(err: &ApiError) -> &str {
        match err {
            ApiError::Validation { code, .. } => code.as_str(),
            _ => panic!("expected ApiError::Validation (422)"),
        }
    }

    /// Spec `api_rejects_exceeding_velocity`: a movej velocity above the
    /// planner's PhysicalEnvelope MUST be explicitly rejected with HTTP 422
    /// and the machine-readable `PhysicalEnvelopeExceeded` code — never
    /// silently clamped to the envelope ceiling.
    #[test]
    fn exceeding_velocity_rejected_with_422_physical_envelope_exceeded() {
        let result = reject_envelope_exceeded(Some(30.0), None, SCARA_ENVELOPE);
        assert!(
            result.is_err(),
            "velocity 30 > SCARA ceiling 25 must be REJECTED, not clamped"
        );
        let err = match result {
            Err(e) => e,
            Ok(()) => unreachable!(),
        };
        assert_eq!(envelope_error_code(&err), "PhysicalEnvelopeExceeded");
        match &err {
            ApiError::Validation { message, .. } => {
                assert!(
                    message.contains("velocity") && message.contains('3') && message.contains('0'),
                    "message must name the offending velocity: {message}"
                );
            }
            _ => unreachable!(),
        }
        // ApiError::Validation maps to HTTP 422 UNPROCESSABLE_ENTITY.
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// Spec `api_rejects_exceeding_acceleration`: same explicit rejection for
    /// an acceleration above the envelope ceiling.
    #[test]
    fn exceeding_acceleration_rejected_with_422_physical_envelope_exceeded() {
        let err = match reject_envelope_exceeded(None, Some(1000.0), SCARA_ENVELOPE) {
            Err(e) => e,
            Ok(()) => panic!("acceleration 1000 > SCARA ceiling 600 must be REJECTED"),
        };
        assert_eq!(envelope_error_code(&err), "PhysicalEnvelopeExceeded");
        match &err {
            ApiError::Validation { message, .. } => {
                assert!(
                    message.contains("acceleration"),
                    "message must name the offending acceleration: {message}"
                );
            }
            _ => unreachable!(),
        }
        assert_eq!(err.into_response().status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// Within-envelope requests pass untouched — the reject is explicit, not
    /// a general gate on motion.
    #[test]
    fn within_envelope_velocity_and_acceleration_accepted() {
        assert!(reject_envelope_exceeded(Some(10.0), Some(200.0), SCARA_ENVELOPE).is_ok());
    }

    /// At-ceiling requests are ACCEPTED (inclusive comparison).
    #[test]
    fn at_ceiling_velocity_accepted() {
        assert!(reject_envelope_exceeded(Some(25.0), None, SCARA_ENVELOPE).is_ok());
    }

    /// Omitted velocity/acceleration → planner defaults, no rejection.
    #[test]
    fn omitted_velocity_and_acceleration_accepted() {
        assert!(reject_envelope_exceeded(None, None, SCARA_ENVELOPE).is_ok());
    }

    /// ADR-2 no-silent-mutation (API half, Correction F): a requested velocity
    /// above the envelope is rejected — the envelope ceiling is NEVER returned
    /// as a substitute. The error is explicit; no clamped value exists.
    #[test]
    fn exceeding_velocity_never_silently_reduced() {
        let err = match reject_envelope_exceeded(Some(25.1), None, SCARA_ENVELOPE) {
            Err(e) => e,
            Ok(()) => panic!("must reject, never reduce 25.1 to the 25.0 ceiling"),
        };
        assert_eq!(envelope_error_code(&err), "PhysicalEnvelopeExceeded");
    }

    /// Generic envelope (unknown chains) uses the most conservative ceiling —
    /// a request fine for SCARA may still exceed it.
    #[test]
    fn generic_envelope_rejects_above_conservative_ceiling() {
        let generic = PhysicalEnvelope {
            max_velocity: 15.0,
            max_acceleration: 400.0,
        };
        assert!(reject_envelope_exceeded(Some(20.0), None, generic).is_err());
        assert!(reject_envelope_exceeded(Some(10.0), None, generic).is_ok());
    }
}
