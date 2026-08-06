use serde::{Deserialize, Serialize};

/// Wire representation of an execution backend (resilience-presentation
/// PR2a). `status` is "active" | "inactive"; `connected` reports whether the
/// backend currently holds a connected controller.
#[derive(Debug, Serialize)]
pub struct BackendDto {
    pub id: String,
    pub name: String,
    pub status: String,
    pub connected: bool,
    pub port: Option<String>,
}

/// Body of `POST /backends/{id}/connect` — the serial port to open.
#[derive(Debug, Deserialize)]
pub struct ConnectRequest {
    pub port: String,
}
