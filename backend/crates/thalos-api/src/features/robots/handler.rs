use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::robots::dto::RobotMetadataDto;

pub async fn list_robots(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Vec<RobotMetadataDto>> {
    let robots = state.services.robots.list_models();
    Ok(Json(robots.into_iter().map(Into::into).collect()))
}

pub async fn get_robot(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> ApiResult<RobotMetadataDto> {
    let robot = state
        .services
        .robots
        .get_metadata(&id)
        .ok_or_else(|| ApiError::NotFound {
            message: format!("Robot '{}' not found", id),
        })?;

    Ok(Json(robot.into()))
}
