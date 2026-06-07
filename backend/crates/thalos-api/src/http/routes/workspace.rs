use std::sync::Arc;

use axum::{
    routing::post,
    Router,
};

use crate::app::state::AppState;
use crate::features::workspace::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/workspace/sample", post(handler::sample))
        .route("/workspace/reachability", post(handler::reachability))
}
