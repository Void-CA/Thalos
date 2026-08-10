use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};

use serde_json::{Value, json};
use thalos_models::urdf::parser::parse_robot;

use thalos_core::{
    execution::runtime::RuntimeProgram,
    kinematics::{forward::ForwardKinematics, inverse::DampedLeastSquaresSolver},
    models::RobotModel,
    operation::Operation,
    robot::{adapter, state::RobotState},
};
use thalos_planning::{
    error::CompileError,
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::PlanningContext,
    },
};
use thalos_runtime::{Command, snapshots::scene::JointMeta};
use thalos_visual::validator::SceneError;
use thalos_visual::{
    ScaraVisualBuilder, SceneBuilder, SceneDiff, SceneValidator, VisualScene, map_visuals,
};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::scene::dto::mappers::delta::to_delta_response;
use crate::features::scene::dto::mappers::runtime::build_plan_dto;
use crate::features::scene::dto::requests::{SeekRequest, StartExecutionRequest, TickRequest};
use crate::features::scene::dto::*;

/// Build a VisualScene from a RuntimeSnapshot.
pub(crate) fn build_visual_scene(snapshot: &thalos_runtime::RuntimeSnapshot) -> VisualScene {
    let fk = &snapshot.fk_result;
    let chain = &snapshot.chain;

    if let Some(robot) = &snapshot.robot_source {
        let elements = map_visuals(robot, chain);
        let visual_count: usize = robot.links.values().map(|l| l.visual.len()).sum();
        tracing::info!(
            robot = %robot.name,
            links = robot.links.len(),
            visuals = visual_count,
            mapped = elements.len(),
            "URDF visual pipeline — primitives from source model",
        );
        let builder = SceneBuilder::new(chain);
        builder.with_visual_elements(fk, &elements)
    } else {
        match snapshot.robot {
            Some(RobotModel::Scara) => ScaraVisualBuilder::build(fk, chain),
            _ => {
                let builder = SceneBuilder::new(chain);
                builder.from_fk(fk)
            }
        }
    }
}

/// Build an API response from a RuntimeSnapshot.
pub(crate) fn to_api_response(snapshot: &thalos_runtime::RuntimeSnapshot) -> RuntimeStateResponse {
    let scene: VisualSceneDto = build_visual_scene(snapshot).into();
    let plan = build_plan_dto(snapshot);
    RuntimeStateResponse::from_snapshot(snapshot, scene, plan)
}

pub async fn get_scene(State(state): State<Arc<AppState>>) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn set_joints(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SetJointsRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .execute(Command::SetJoints(payload.joint_angles))
        .await?;

    Ok(Json(to_api_response(&snapshot)))
}

pub async fn load_robot(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoadRobotRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let cmd = payload.into_command()?;
    let snapshot = state.services.scene.execute(cmd).await?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn load_robot_from_urdf(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoadUrdfRobotRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let robot = parse_robot(&payload.urdf_source).map_err(|e| ApiError::Validation {
        message: format!("Invalid URDF: {e}"),
        code: "invalid_urdf".into(),
    })?;

    let name = robot.name.clone();
    let chain = adapter::auto(&robot).map_err(|e| ApiError::Validation {
        message: format!("Cannot build chain: {e}"),
        code: "urdf_chain_error".into(),
    })?;

    // Build joint metadata from parsed URDF joints.
    // Fixed joints are filtered out — they don't consume a slot in the
    // runtime joints array and the frontend should not show sliders for them.
    let joints_meta: Vec<JointMeta> = robot
        .bfs_joints()
        .unwrap_or_default()
        .iter()
        .filter(|j| !j.kind.is_fixed())
        .map(|j| JointMeta {
            name: j.name.clone(),
            kind: j.kind.to_string(),
            min: j.limits.map(|l| l.min),
            max: j.limits.map(|l| l.max),
        })
        .collect();

    let cmd = Command::LoadUrdfRobot {
        name,
        joints_meta,
        chain,
        robot,
        // Stable identity from the raw XML (spec R1): same file → same id.
        robot_id: urdf_robot_id(&payload.urdf_source),
    };

    let snapshot = state.services.scene.execute(cmd).await?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn move_to_position(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPositionRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_frame = snapshot.resolve_default_frame();
    let cmd = payload.into_command(default_frame);

    let snapshot = state.services.scene.execute(cmd).await?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn move_to_pose(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPoseRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_frame = snapshot.resolve_default_frame();
    let cmd = payload.into_command(default_frame);

    let snapshot = state.services.scene.execute(cmd).await?;
    Ok(Json(to_api_response(&snapshot)))
}

// ─── Motion program ──────────────────────────────────────────────────────

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

/// Preview a multi-segment motion program.
///
/// Compiles the program, stores the result for visualisation, and returns
/// the updated runtime state. The robot does NOT move — this is strictly
/// a "compile + preview" operation. Execution requires a subsequent
/// call to `start_execution`.
pub async fn preview_plan(
    State(state): State<Arc<AppState>>,
    Json(mut payload): Json<MotionPlanRequest>,
) -> ApiResult<RuntimeStateResponse> {
    // Phase 1 — read snapshot, build program, compile (all sync except the snapshot read)
    let compiled = {
        let snapshot = state.services.scene.snapshot().await?;
        let default_frame = snapshot.resolve_default_frame();

        let fk = ForwardKinematics::new(snapshot.chain.clone());
        let solver =
            DampedLeastSquaresSolver::new(fk, default_frame, IK_MAX_ITERS, IK_TOLERANCE, IK_LAMBDA);
        let robot_state = RobotState::new(snapshot.joints.clone());
        let ctx = PlanningContext {
            robot: &snapshot.chain,
            current_state: &robot_state,
            ik_solver: &solver,
            tcp: snapshot.active_tcp.as_ref(),
        };
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let map_err = |err: CompileError| ApiError::Validation {
            message: err.to_string(),
            code: format!("segment_{}_failed", err.segment_index),
        };

        // Semantic path: `operations` present → compile_with_operations(),
        // preserving provenance + building the RangeConstraintQuery for
        // downstream optimization. Legacy path: `segments` only → compile().
        // NOTE: preview_plan itself never invokes the optimization pipeline —
        // optimization is a separate endpoint operating on the stored active
        // plan. Threading the constraint_query into optimize() requires
        // persisting it alongside the plan (see apply-progress follow-up).
        if let Some(ops) = payload.operations.take() {
            if ops.is_empty() {
                return Ok(Json(to_api_response(&snapshot)));
            }
            let operations: Vec<Operation> = ops
                .into_iter()
                .map(|op| op.into_operation(default_frame))
                .collect();
            compiler
                .compile_with_operations(&operations, &ctx)
                .map_err(map_err)?
                .plan
        } else {
            let program = payload.into_program(default_frame);
            if program.segments.is_empty() {
                return Ok(Json(to_api_response(&snapshot)));
            }
            compiler.compile(&program, &ctx).map_err(map_err)?
        }
    };
    // snapshot, fk, solver, ctx, robot_state, program dropped here

    // Phase 2 — schedule (async), clean scope
    let snapshot = state
        .services
        .scene
        .schedule_program(compiled, RuntimeProgram::default())
        .await?;
    Ok(Json(to_api_response(&snapshot)))
}

// ─── Execution control ────────────────────────────────────────────────────

/// Start execution of the scheduled motion plan.
pub async fn start_execution(
    State(state): State<Arc<AppState>>,
    payload: Option<Json<StartExecutionRequest>>,
) -> ApiResult<RuntimeStateResponse> {
    let request = payload.map(|Json(req)| req).unwrap_or_default();
    request.validate().map_err(|message| ApiError::BadRequest {
        message,
        code: "invalid_execution_mode".into(),
    })?;
    let snapshot = state
        .services
        .scene
        .start_execution_with_mode(request.mode)
        .await?;
    Ok(Json(to_api_response(&snapshot)))
}

/// Pause execution.
pub async fn pause_execution(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.pause_execution().await?;
    Ok(Json(to_api_response(&snapshot)))
}

/// Resume a paused execution.
pub async fn resume_execution(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.resume_execution().await?;
    Ok(Json(to_api_response(&snapshot)))
}

/// Cancel execution.
pub async fn cancel_execution(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.cancel_execution().await?;
    Ok(Json(to_api_response(&snapshot)))
}

/// Reset the execution session (back to Ready state for re-run).
pub async fn reset_execution(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.reset_execution().await?;
    Ok(Json(to_api_response(&snapshot)))
}

/// Seek execution to a position (fraction 0.0–1.0).
///
/// Only meaningful for replay/simulation backends.
/// Hardware backends return an error.
pub async fn seek_execution(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SeekRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .seek_execution(payload.position)
        .await?;
    Ok(Json(to_api_response(&snapshot)))
}

// ─── Execution tick ───────────────────────────────────────────────────────

/// Advance execution by `dt` seconds.
///
/// Called periodically by the frontend during active execution.
/// Devuelve solo `RuntimeDelta` — joint angles, link transforms y estado
/// de ejecución — sin la escena completa ni la trayectoria planificada.
///
/// La escena (frames, primitives, metadata del robot, trayectoria) es
/// inmutable durante la ejecución y se obtiene via `GET /scene`.
pub async fn tick_execution(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TickRequest>,
) -> ApiResult<RuntimeDelta> {
    let dt = payload.dt.max(0.001);
    let delta = state.services.scene.tick_execution_delta(dt).await?;
    Ok(Json(to_delta_response(&delta)))
}

// ─── Solve IK (no mutation) ──────────────────────────────────────────────

pub async fn solve_ik_position(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPositionRequest>,
) -> ApiResult<SolveIKResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_ee = *snapshot.chain.end_effector();
    let (frame, goal) = payload.to_ik_goal(default_ee);

    let (joints, ik) = state.services.scene.solve_ik(frame, goal).await?;
    Ok(Json(SolveIKResponse {
        joints,
        ik_result: ik.into(),
    }))
}

pub async fn solve_ik_pose(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPoseRequest>,
) -> ApiResult<SolveIKResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_ee = *snapshot.chain.end_effector();
    let (frame, goal) = payload.to_ik_goal(default_ee);

    let (joints, ik) = state.services.scene.solve_ik(frame, goal).await?;
    Ok(Json(SolveIKResponse {
        joints,
        ik_result: ik.into(),
    }))
}

/// Apply solved joint angles to the runtime (move the robot).
pub async fn execute_ik(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ExecuteIKRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .execute(Command::SetJoints(payload.joint_angles))
        .await?;
    Ok(Json(to_api_response(&snapshot)))
}

fn scene_error_to_response(err: &SceneError) -> (StatusCode, Json<Value>) {
    let (code, extra) = match err {
        SceneError::MissingWorld => ("MISSING_WORLD", json!({})),
        SceneError::MissingFrame(id) => ("MISSING_FRAME", json!({ "frame": id })),
        SceneError::DuplicateId { id } => ("DUPLICATE_ID", json!({ "frame": id })),
        SceneError::BrokenTopology { frame: _ } => ("BROKEN_TOPOLOGY", json!({})),
        SceneError::NonFiniteValue { frame } => ("NON_FINITE_VALUE", json!({ "frame": frame })),
        SceneError::InvalidQuaternion { frame, norm } => (
            "INVALID_QUATERNION",
            json!({ "frame": frame, "norm": norm }),
        ),
        SceneError::OrphanLink { index } => ("ORPHAN_LINK", json!({ "index": index })),
        SceneError::TwistsMismatch { expected, found } => (
            "TWISTS_MISMATCH",
            json!({ "expected": expected, "found": found }),
        ),
    };

    let mut body = json!({
        "error": err.to_string(),
        "code": code,
    });
    if let Some(obj) = extra.as_object() {
        body.as_object_mut().unwrap().extend(obj.clone());
    }

    (StatusCode::UNPROCESSABLE_ENTITY, Json(body))
}

pub async fn validate(
    _state: State<Arc<AppState>>,
    Json(payload): Json<ValidateRequest>,
) -> impl IntoResponse {
    let scene: VisualScene = payload.scene.into();
    let validator = SceneValidator::default();

    match validator.validate(&scene) {
        Ok(_) => (StatusCode::OK, Json(json!({ "valid": true }))).into_response(),
        Err(e) => scene_error_to_response(&e).into_response(),
    }
}

pub async fn diff(
    _state: State<Arc<AppState>>,
    Json(payload): Json<DiffRequest>,
) -> ApiResult<SceneDiffDto> {
    let old: VisualScene = payload.old.into();
    let new: VisualScene = payload.new.into();

    let result = SceneDiff::between(&old, &new, payload.epsilon);

    Ok(Json(result.into()))
}

/// Select or clear the active Tool Center Point (TCP).
///
/// POST /api/v1/scene/tcp
///
/// When `frame_id` is provided, sets the TCP to that frame with an optional offset.
/// When `frame_id` is `None`, clears the TCP (falls back to flange/end_effector).
///
/// The TCP affects all operational analyses:
/// - Workspace sampling
/// - Singularity analysis
/// - Manipulability analysis
/// - IK solving (default frame)
/// - Motion planning (trajectory visualization)
pub async fn select_tool_frame(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SelectToolFrameRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let cmd = payload.into_command();
    let snapshot = state.services.scene.execute(cmd).await?;
    Ok(Json(to_api_response(&snapshot)))
}

/// Stable robot identity for URDF imports (spec robot-identity R1).
///
/// Deterministic `urdf:<hash>` id derived from the raw XML source: SHA-256 of
/// the raw bytes, truncated to the first 6 bytes (12 hex chars). Same file →
/// same id (R1.1); different bytes → different id. The raw source is used
/// (design D1) so the id never depends on parser behavior.
fn urdf_robot_id(source: &str) -> String {
    use sha2::{Digest, Sha256};

    let hash = Sha256::digest(source.as_bytes());
    format!("urdf:{}", hex::encode(&hash[..6]))
}

#[cfg(test)]
mod tests {
    use super::urdf_robot_id;

    /// Spec robot-identity R1.1: the URDF robot id MUST be deterministic —
    /// the same raw XML always yields the same `urdf:<hash>` id.
    #[test]
    fn same_source_yields_same_id() {
        let source = r#"<robot name="a"><link name="base"/></robot>"#;
        let first = urdf_robot_id(source);
        let second = urdf_robot_id(source);
        assert_eq!(
            first, second,
            "identical URDF source must produce identical robot ids"
        );
        assert_ne!(first, "urdf", "id must not be the legacy literal 'urdf'");
    }

    /// Spec robot-identity R1.1: two URDF files differing by at least one
    /// byte MUST produce different ids.
    #[test]
    fn different_source_yields_different_id() {
        let a = urdf_robot_id(r#"<robot name="a"><link name="base"/></robot>"#);
        let b = urdf_robot_id(r#"<robot name="b"><link name="base"/></robot>"#);
        assert_ne!(
            a, b,
            "URDF sources differing by one byte must yield different ids"
        );
    }

    /// Spec robot-identity R1.1: the id MUST match `urdf:<12 lowercase hex>`.
    #[test]
    fn id_matches_urdf_hash_format() {
        let id =
            urdf_robot_id(r#"<robot name="icebot"><link name="base"/><link name="tool"/></robot>"#);
        assert!(
            id.starts_with("urdf:"),
            "id must carry urdf: prefix, got {id}"
        );
        let hash = &id["urdf:".len()..];
        assert_eq!(hash.len(), 12, "id must carry 12 hex chars, got {id}");
        assert!(
            hash.chars().all(|c| c.is_ascii_hexdigit()),
            "id hash must be lowercase hex, got {id}"
        );
    }
}
