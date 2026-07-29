use std::sync::Arc;

use axum::{Router, routing::post};

use crate::app::state::AppState;
use crate::features::semantic::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/semantic/compile", post(handler::compile_semantic))
}
