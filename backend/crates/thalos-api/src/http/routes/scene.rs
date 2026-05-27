use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::app::state::AppState;
use crate::features::scene::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // Current visual scene
        .route("/scene", get(handler::get_scene))

        // Runtime mutations
        .route("/scene/joints", post(handler::set_joints))
        .route("/scene/robot", post(handler::load_robot))

        // Utilities
        .route("/scene/validate", post(handler::validate))
        .route("/scene/diff", post(handler::diff))
}