pub mod routes;

use std::sync::Arc;

use axum::Router;

use crate::app::state::AppState;
use routes::{motion, plan, robots, scene, session, workspace};

pub fn app_router() -> Router<Arc<AppState>> {
    Router::new().nest(
        "/api/v1",
        Router::new()
            .merge(scene::routes())
            .merge(robots::routes())
            .merge(workspace::routes())
            .merge(motion::routes())
            .merge(plan::routes())
            .merge(session::routes()),
    )
}
