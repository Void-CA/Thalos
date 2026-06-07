pub mod routes;

use std::sync::Arc;

use axum::Router;

use crate::app::state::AppState;
use routes::{robots, scene, workspace};

pub fn app_router() -> Router<Arc<AppState>> {
    Router::new().nest(
        "/api/v1",
        Router::new()
            .merge(scene::routes())
            .merge(robots::routes())
            .merge(workspace::routes()),
    )
}
