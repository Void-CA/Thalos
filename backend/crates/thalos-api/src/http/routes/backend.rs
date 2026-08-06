use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::app::state::AppState;
use crate::features::backend::handler;

/// Execution backend management (resilience-presentation PR2a): list, switch,
/// connect and disconnect the execution backends.
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/backends", get(handler::list_backends))
        .route("/backends/{id}/activate", post(handler::activate_backend))
        .route("/backends/{id}/connect", post(handler::connect_backend))
        .route("/backends/{id}/disconnect", post(handler::disconnect_backend))
}
