use std::sync::Arc;

use axum::{
    routing::post,
    Router,
};

use crate::app::state::AppState;
use crate::features::plan_analysis::{alternatives, handler};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/plan/analyze", post(handler::analyze_plan))
        .route("/plan/analyze/alternatives", post(alternatives::analyze_alternatives))
}
