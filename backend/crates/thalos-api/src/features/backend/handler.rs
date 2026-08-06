use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};

use thalos_runtime::error::ControllerError;

use crate::app::dto::ErrorResponse;
use crate::app::state::AppState;
use crate::features::backend::dto::{BackendDto, ConnectRequest};

/// Map a backend-management `ControllerError` to its HTTP status + code
/// (PR2a spec "Error Codes"): `not_found` → 404; `no_firmware`, `port_in_use`,
/// `not_connected`, `connection_lost` → 400; `already_connected` → 409.
fn backend_error(e: ControllerError) -> (StatusCode, Json<ErrorResponse>) {
    let code = e.error_code();
    let status = match &e {
        ControllerError::NotFound(_) => StatusCode::NOT_FOUND,
        ControllerError::NoFirmware
        | ControllerError::PortInUse(_)
        | ControllerError::ConnectionLost
        | ControllerError::NotConnected => StatusCode::BAD_REQUEST,
        ControllerError::AlreadyConnected => StatusCode::CONFLICT,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(ErrorResponse {
            error: e.to_string(),
            code: code.into(),
        }),
    )
}

type BackendResult = Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)>;

/// `GET /backends` — all registered execution backends with status.
pub async fn list_backends(State(state): State<Arc<AppState>>) -> Json<Vec<BackendDto>> {
    let active_id = state.services.manager.active_id().await;
    let entries = state.services.manager.list_backends().await;

    let mut dtos = Vec::with_capacity(entries.len());
    for entry in entries {
        let connected = match &entry.controller {
            Some(ctrl) => ctrl.read().await.is_connected(),
            None => false,
        };
        dtos.push(BackendDto {
            id: entry.id.clone(),
            name: entry.name.clone(),
            status: if active_id.as_deref() == Some(entry.id.as_str()) {
                "active".to_string()
            } else {
                "inactive".to_string()
            },
            connected,
            port: entry.port.clone(),
        });
    }
    Json(dtos)
}

/// `POST /backends/{id}/activate` — make `id` the active backend.
pub async fn activate_backend(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> BackendResult {
    state
        .services
        .manager
        .activate(&id)
        .await
        .map_err(backend_error)?;
    Ok(Json(serde_json::json!({ "status": "ok", "backend": id })))
}

/// `POST /backends/{id}/connect` — open `port` and handshake with the
/// firmware (lazy Esp32 factory). 400 `port_in_use` / `no_firmware`.
pub async fn connect_backend(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<ConnectRequest>,
) -> BackendResult {
    state
        .services
        .manager
        .connect_with_port(&id, &req.port)
        .await
        .map_err(backend_error)?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "backend": id, "connected": true }),
    ))
}

/// `POST /backends/{id}/disconnect` — close the backend's serial connection.
/// 400 `not_connected` when the backend has no connected controller.
pub async fn disconnect_backend(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> BackendResult {
    state
        .services
        .manager
        .disconnect_backend(&id)
        .await
        .map_err(backend_error)?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "backend": id, "connected": false }),
    ))
}
