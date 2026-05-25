use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::app::state::AppState;
use crate::features::scene::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/scene", get(handler::get_scene))
        .route("/scene/from-fk", post(handler::from_fk))
        .route("/scene/validate", post(handler::validate))
        .route("/scene/diff", post(handler::diff))
}
