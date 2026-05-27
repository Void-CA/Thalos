use std::sync::Arc;

use axum::{
    Json, extract::{Path, State}, response::IntoResponse
};

use crate::{
    app::state::AppState,
    features::robots::dto::RobotMetadataDto,
};

pub async fn list_robots(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let robots = state
        .services
        .robots
        .list_models();

    Json(
        robots
            .into_iter()
            .map(Into::into)
            .collect()
    )
}

pub async fn get_robot(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.services.robots.get_metadata(&id) {
        Some(robot) => Json(robot.into()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}