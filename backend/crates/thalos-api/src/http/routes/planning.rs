use std::sync::Arc;

use axum::{Router, routing::post};

use crate::app::state::AppState;
use crate::features::planning::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/planning/plan", post(handler::plan_motion))
}
