use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::app::state::AppState;
use crate::http::handlers::scene;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/scene", get(scene::get_scene))
        .route("/scene/from-fk", post(scene::from_fk))
        .route("/scene/validate", post(scene::validate))
        .route("/scene/diff", post(scene::diff))
}
