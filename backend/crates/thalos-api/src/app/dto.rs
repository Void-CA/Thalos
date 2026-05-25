use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thalos_visual::{SceneError, VisualScene};

// ── Request DTOs ──

#[derive(Deserialize)]
pub struct FromFkRequest {
    pub joint_angles: Vec<f64>,
}

#[derive(Deserialize)]
pub struct ValidateRequest {
    pub scene: VisualScene,
}

#[derive(Deserialize)]
pub struct DiffRequest {
    pub old: VisualScene,
    pub new: VisualScene,
    #[serde(default = "default_epsilon")]
    pub epsilon: f64,
}

fn default_epsilon() -> f64 {
    1e-6
}

// ── Response DTOs ──

#[derive(Serialize)]
pub struct SceneResponse {
    pub scene: VisualScene,
    pub generated_at: DateTime<Utc>,
}

impl SceneResponse {
    pub fn new(scene: VisualScene) -> Self {
        Self {
            scene,
            generated_at: Utc::now(),
        }
    }
}

#[derive(Serialize)]
pub struct ValidateResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Error model ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    MissingWorld,
    MissingFrame,
    DuplicateId,
    BrokenTopology,
    NonFiniteValue,
    InvalidQuaternion,
    OrphanLink,
    TwistsMismatch,
}

#[derive(Serialize)]
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

impl From<&SceneError> for ErrorResponse {
    fn from(e: &SceneError) -> Self {
        match e {
            SceneError::MissingWorld => Self {
                error: e.to_string(),
                code: ErrorCode::MissingWorld,
                frame: None,
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::MissingFrame(id) => Self {
                error: e.to_string(),
                code: ErrorCode::MissingFrame,
                frame: Some(id.clone()),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::DuplicateId { id } => Self {
                error: e.to_string(),
                code: ErrorCode::DuplicateId,
                frame: Some(id.clone()),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::BrokenTopology { frame } => Self {
                error: e.to_string(),
                code: ErrorCode::BrokenTopology,
                frame: Some(frame.clone()),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::NonFiniteValue { frame } => Self {
                error: e.to_string(),
                code: ErrorCode::NonFiniteValue,
                frame: Some(frame.clone()),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::InvalidQuaternion { frame, norm } => Self {
                error: e.to_string(),
                code: ErrorCode::InvalidQuaternion,
                frame: Some(frame.clone()),
                index: None,
                norm: Some(*norm),
                expected: None,
                found: None,
            },
            SceneError::OrphanLink { index } => Self {
                error: e.to_string(),
                code: ErrorCode::OrphanLink,
                frame: None,
                index: Some(*index),
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::TwistsMismatch { expected, found } => Self {
                error: e.to_string(),
                code: ErrorCode::TwistsMismatch,
                frame: None,
                index: None,
                norm: None,
                expected: Some(*expected),
                found: Some(*found),
            },
        }
    }
}
