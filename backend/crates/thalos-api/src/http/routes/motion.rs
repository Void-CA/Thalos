use std::sync::Arc;

use axum::{Router, routing::post};

use crate::app::state::AppState;
use crate::features::motion::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/motion/movej", post(handler::movej))
        .route("/motion/movel", post(handler::movel))
        .route("/motion/plan", post(handler::plan))
}
