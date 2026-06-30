use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::{json, Value};
use thalos_models::urdf::parser::parse_robot;

use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        inverse::DampedLeastSquaresSolver,
    },
    models::RobotModel,
    robot::{adapter, state::RobotState},
};
use thalos_planning::{
    error::CompileError,
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::PlanningContext,
    },
};
use thalos_runtime::{snapshots::scene::JointMeta, Command};
use thalos_visual::{
    map_visuals, SceneBuilder, SceneDiff, SceneValidator, ScaraVisualBuilder, VisualScene,
};
use thalos_visual::validator::SceneError;

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::scene::dto::mappers::delta::to_delta_response;
use crate::features::scene::dto::mappers::runtime::build_plan_dto;
use crate::features::scene::dto::requests::TickRequest;
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
            RobotModel::Scara => ScaraVisualBuilder::build(fk, chain),
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

pub async fn get_scene(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
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
        .execute(Command::SetJoints(payload.joint_angles))?;

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
    let robot = parse_robot(&payload.urdf_source).map_err(|e| {
        ApiError::Validation {
            message: format!("Invalid URDF: {e}"),
            code: "invalid_urdf".into(),
        }
    })?;

    let name = robot.name.clone();
    let chain = adapter::auto(&robot).map_err(|e| {
        ApiError::Validation {
            message: format!("Cannot build chain: {e}"),
            code: "urdf_chain_error".into(),
        }
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
    };

    let snapshot = state.services.scene.execute(cmd).await?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn move_to_position(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPositionRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_ee = *snapshot.chain.end_effector();
    let cmd = payload.into_command(default_ee);

    let snapshot = state.services.scene.execute(cmd).await?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn move_to_pose(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPoseRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_ee = *snapshot.chain.end_effector();
    let cmd = payload.into_command(default_ee);

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
    Json(payload): Json<MotionPlanRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot().await?;
    let default_ee = *snapshot.chain.end_effector();

    // Build the motion program from the request
    let program = payload.into_program(default_ee);

    if program.segments.is_empty() {
        // Nothing to plan — return current state
        return Ok(Json(to_api_response(&snapshot)));
    }

    // Create an IK solver and planning context from the runtime state
    let fk = ForwardKinematics::new(snapshot.chain.clone());
    let solver = DampedLeastSquaresSolver::new(
        fk,
        default_ee,
        IK_MAX_ITERS,
        IK_TOLERANCE,
        IK_LAMBDA,
    );
    let robot_state = RobotState::new(snapshot.joints.clone());
    let ctx = PlanningContext {
        robot: &snapshot.chain,
        current_state: &robot_state,
        ik_solver: &solver,
    };

    // Compile
    let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
    let compiled = compiler
        .compile(&program, &ctx)
        .map_err(|err: CompileError| {
            ApiError::Validation {
                message: err.to_string(),
                code: format!("segment_{}_failed", err.segment_index),
            }
        })?;

    // Schedule the plan (no execution)
    let snapshot = state.services.scene.schedule_program(compiled).await?;
    Ok(Json(to_api_response(&snapshot)))
}


// ─── Execution control ────────────────────────────────────────────────────

/// Start execution of the scheduled motion plan.
pub async fn start_execution(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.start_execution().await?;
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
        .execute(Command::SetJoints(payload.joint_angles))?;
    Ok(Json(to_api_response(&snapshot)))
}

fn scene_error_to_response(err: &SceneError) -> (StatusCode, Json<Value>) {
    let (code, extra) = match err {
        SceneError::MissingWorld => ("MISSING_WORLD", json!({})),
        SceneError::MissingFrame(id) => ("MISSING_FRAME", json!({ "frame": id })),
        SceneError::DuplicateId { id } => ("DUPLICATE_ID", json!({ "frame": id })),
        SceneError::BrokenTopology { frame: _ } => ("BROKEN_TOPOLOGY", json!({})),
        SceneError::NonFiniteValue { frame } => ("NON_FINITE_VALUE", json!({ "frame": frame })),
        SceneError::InvalidQuaternion { frame, norm } => {
            ("INVALID_QUATERNION", json!({ "frame": frame, "norm": norm }))
        }
        SceneError::OrphanLink { index } => ("ORPHAN_LINK", json!({ "index": index })),
        SceneError::TwistsMismatch { expected, found } => {
            ("TWISTS_MISMATCH", json!({ "expected": expected, "found": found }))
        }
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
