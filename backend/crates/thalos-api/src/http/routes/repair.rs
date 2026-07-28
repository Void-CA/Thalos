use std::sync::Arc;

use axum::{
    Router,
    routing::{delete, post},
};

use crate::app::state::AppState;
use crate::features::repair::{handler, session_handler};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // Repair options (M8.2)
        .route("/plan/repair/options", post(handler::repair_options))
        .route("/plan/repair/apply", post(handler::repair_apply))
        // Repair sessions (M8.4)
        .route("/repair/sessions", post(session_handler::create_session))
        .route(
            "/repair/sessions/{id}",
            delete(session_handler::delete_session),
        )
        .route(
            "/repair/sessions/{id}/preview",
            post(session_handler::preview_repair),
        )
        .route(
            "/repair/sessions/{id}/apply",
            post(session_handler::apply_repair),
        )
        .route(
            "/repair/sessions/{id}/undo",
            post(session_handler::undo_repair),
        )
}
