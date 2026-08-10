use std::sync::Arc;

use axum::{Router, routing::post};

use crate::app::state::AppState;
use crate::features::plan_analysis::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/plan/analyze", post(handler::analyze_plan))
        .route("/plan/optimize", post(handler::handle_optimize))
        .route(
            "/plan/commands/preview",
            post(handler::preview_command),
        )
        .route(
            "/plan/commands/apply",
            post(handler::apply_command),
        )
        .route(
            "/plan/commands/undo",
            post(handler::undo_command),
        )
        .route(
            "/plan/program/edit",
            post(handler::edit_program),
        )
}
