pub mod handlers;
pub mod routes;

use std::sync::Arc;

use axum::Router;

use crate::app::state::AppState;
use routes::scene;

pub fn app_router() -> Router<Arc<AppState>> {
    Router::new().nest("/api", scene::routes())
}
