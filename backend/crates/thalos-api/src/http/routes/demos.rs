use std::sync::Arc;

use axum::{Router, routing::get};

use crate::app::state::AppState;
use crate::features::demos::handler;

/// Demo catalog endpoints under `/api/v1` (D9/D10). GET-only per D12 — NO
/// POST/PUT/PATCH endpoints for scenes or programs (load = picker or API,
/// save = browser download; git is the source of truth).
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/demos", get(handler::list_demos))
        .route("/demos/{id}/scene", get(handler::get_demo_scene))
        .route("/demos/{id}/program", get(handler::get_demo_program))
}
