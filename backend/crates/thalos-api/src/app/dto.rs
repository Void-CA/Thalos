use serde::Serialize;

// ── Shared error model ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // Generic
    NotFound,
    Internal,
    // Scene-specific
    MissingWorld,
    MissingFrame,
    DuplicateId,
    BrokenTopology,
    NonFiniteValue,
    InvalidQuaternion,
    OrphanLink,
    TwistsMismatch,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: ErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub norm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub found: Option<usize>,
}
