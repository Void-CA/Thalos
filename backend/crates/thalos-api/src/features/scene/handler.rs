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


pub async fn get_scene(
    State(state): State<Arc<AppState>>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state.services.scene.snapshot()?;
    let scene = build_visual_scene(&snapshot);

    Ok(Json(RuntimeStateResponse {
        robot: snapshot.robot.metadata().into(),
        joints: snapshot.joints,
        scene: scene.into(),
        generated_at: snapshot.generated_at,
    }))
}

pub async fn set_joints(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SetJointsRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let snapshot = state
        .services
        .scene
        .execute(Command::SetJoints(payload.joint_angles))?;

    let scene = build_visual_scene(&snapshot);

    Ok(Json(RuntimeStateResponse {
        robot: snapshot.robot.metadata().into(),
        joints: snapshot.joints,
        scene: scene.into(),
        generated_at: snapshot.generated_at,
    }))
}

pub async fn load_robot(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoadRobotRequest>,
) -> ApiResult<RuntimeStateResponse> {
    let model = RobotModel::from_id(&payload.robot_id)?;

    let snapshot = state
        .services
        .scene
        .execute(Command::LoadRobot(model))?;

    let scene = build_visual_scene(&snapshot);

    Ok(Json(RuntimeStateResponse {
        robot: snapshot.robot.metadata().into(),
        joints: snapshot.joints,
        scene: scene.into(),
        generated_at: snapshot.generated_at,
    }))
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
