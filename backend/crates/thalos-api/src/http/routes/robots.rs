use std::sync::Arc;

use axum::{
    routing::get,
    Router,
};

use crate::{AppState, features::robots::handler};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/robots", get(handler::list_robots))
        .route("/robots/{id}", get(handler::get_robot))
}