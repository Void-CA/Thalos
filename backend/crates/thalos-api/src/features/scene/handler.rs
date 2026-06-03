use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_core::models::RobotModel;
use thalos_runtime::Command;
use thalos_visual::{
    SceneBuilder, SceneDiff, SceneValidator, ScaraVisualBuilder, VisualScene,
};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::scene::dto::*;


/// Build a VisualScene from a RuntimeSnapshot.
fn build_visual_scene(snapshot: &thalos_runtime::RuntimeSnapshot) -> VisualScene {
    let robot = snapshot.robot;
    let fk = &snapshot.fk_result;
    let chain = &snapshot.chain;

    match robot {
        RobotModel::Scara => ScaraVisualBuilder::build(fk, chain),
        _ => {
            let builder = SceneBuilder::new(chain);
            builder.from_fk(fk)
        }
    }
}


/// Build an API response from a RuntimeSnapshot.
fn to_api_response(snapshot: &thalos_runtime::RuntimeSnapshot) -> RuntimeStateResponse {
    let scene: VisualSceneDto = build_visual_scene(snapshot).into();
    RuntimeStateResponse::from_snapshot(snapshot, scene)
}

pub async fn get_scene(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot()?;
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
    let snapshot = state.services.scene.execute(cmd)?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn move_to_position(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPositionRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot()?;
    let default_ee = *snapshot.chain.end_effector();
    let cmd = payload.into_command(default_ee);

    let snapshot = state.services.scene.execute(cmd)?;
    Ok(Json(to_api_response(&snapshot)))
}

pub async fn move_to_pose(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPoseRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot()?;
    let default_ee = *snapshot.chain.end_effector();
    let cmd = payload.into_command(default_ee);

    let snapshot = state.services.scene.execute(cmd)?;
    Ok(Json(to_api_response(&snapshot)))
}


// ─── Solve IK (no mutation) ──────────────────────────────────────────────

pub async fn solve_ik_position(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPositionRequest>,
) -> ApiResult<SolveIKResponse> {
    let snapshot = state.services.scene.snapshot()?;
    let default_ee = *snapshot.chain.end_effector();
    let (frame, goal) = payload.to_ik_goal(default_ee);

    let (joints, ik) = state.services.scene.solve_ik(frame, goal)?;
    Ok(Json(SolveIKResponse {
        joints,
        ik_result: ik.into(),
    }))
}

pub async fn solve_ik_pose(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveToPoseRequest>,
) -> ApiResult<SolveIKResponse> {
    let snapshot = state.services.scene.snapshot()?;
    let default_ee = *snapshot.chain.end_effector();
    let (frame, goal) = payload.to_ik_goal(default_ee);

    let (joints, ik) = state.services.scene.solve_ik(frame, goal)?;
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

pub async fn validate(
    _state: State<Arc<AppState>>,
    Json(payload): Json<ValidateRequest>,
) -> ApiResult<ValidateResponse> {
    let scene: VisualScene = payload.scene.into();
    let validator = SceneValidator::default();

    match validator.validate(&scene) {
        Ok(_) => Ok(Json(ValidateResponse {
            valid: true,
            error: None,
        })),
        Err(e) => Ok(Json(ValidateResponse {
            valid: false,
            error: Some(e.to_string()),
        })),
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
