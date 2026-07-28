use std::sync::Arc;

use axum::{Router, routing::post};

use crate::app::state::AppState;
use crate::features::workspace::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/workspace/sample", post(handler::sample))
        .route("/workspace/sample/active", post(handler::sample_active))
        .route("/workspace/bounds/active", post(handler::bounds_active))
        .route("/workspace/analyze/active", post(handler::analyze_active))
        .route("/workspace/reachability", post(handler::reachability))
        .route("/workspace/singularity", post(handler::singularity))
        .route(
            "/workspace/singularity/active",
            post(handler::singularity_active),
        )
        .route("/workspace/manipulability", post(handler::manipulability))
        .route(
            "/workspace/manipulability/active",
            post(handler::manipulability_active),
        )
}
