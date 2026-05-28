use serde::Serialize;

// ── Shared error model ──

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}
