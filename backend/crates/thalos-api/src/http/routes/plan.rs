use std::sync::Arc;

use axum::{
    routing::post,
    Router,
};

use crate::app::state::AppState;
use crate::features::plan_analysis::{alternatives, handler};
use crate::features::repair;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/plan/analyze", post(handler::analyze_plan))
        .route("/plan/analyze/alternatives", post(alternatives::analyze_alternatives))
        .route("/plan/regenerate-from-execution/{session_id}", post(alternatives::regenerate_from_execution))
        .route("/plan/repair/options", post(repair::handler::repair_options))
        .route("/plan/repair/apply", post(repair::handler::repair_apply))
}
