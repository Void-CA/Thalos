use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::app::state::AppState;
use crate::features::session::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/sessions", get(handler::list_sessions))
        .route("/sessions/{id}", get(handler::get_session))
        .route("/sessions/{id}/trace", get(handler::get_trace))
        .route("/sessions/{id}/summary", get(handler::get_session_summary))
        .route("/sessions/{id}/export", get(handler::export_trace_csv))
        .route("/sessions/{id}/replay", post(handler::start_replay))
        .route("/sessions/{id}/execution-trace", get(handler::get_execution_trace))
        .route("/sessions/{id}/statistics", get(handler::get_session_statistics))
        .route("/sessions/{id}/compare", get(handler::compare_plan_execution))
        .route("/sessions/import", post(handler::import_trace))
}
