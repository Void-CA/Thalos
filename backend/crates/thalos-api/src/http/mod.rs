pub mod routes;

use std::sync::Arc;

use axum::Router;

use crate::app::state::AppState;
use routes::{backend, demos, motion, plan, robots, scene, semantic, session, workspace};

pub fn app_router() -> Router<Arc<AppState>> {
    Router::new().nest(
        "/api/v1",
        Router::new()
            .merge(backend::routes())
            .merge(demos::routes())
            .merge(scene::routes())
            .merge(robots::routes())
            .merge(workspace::routes())
            .merge(motion::routes())
            .merge(plan::routes())
            .merge(session::routes())
            .merge(semantic::routes()),
    )
}
