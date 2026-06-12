use std::sync::Arc;

use axum::{routing::post, Router};

use crate::app::state::AppState;
use crate::features::motion::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/motion/movej", post(handler::movej))
        .route("/motion/movel", post(handler::movel))
}
