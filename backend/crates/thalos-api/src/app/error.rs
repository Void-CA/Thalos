use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use thalos_visual::SceneError;

use crate::app::dto::{ErrorCode, ErrorResponse};

#[derive(Debug)]
pub enum ApiError {
    NotFound(String),
    Validation {
        message: String,
        code: ErrorCode,
        frame: Option<String>,
        index: Option<usize>,
        norm: Option<f64>,
        expected: Option<usize>,
        found: Option<usize>,
    },
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            ApiError::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: msg,
                    code: ErrorCode::NotFound,
                    frame: None,
                    index: None,
                    norm: None,
                    expected: None,
                    found: None,
                }),
            ),
            ApiError::Validation {
                message,
                code,
                frame,
                index,
                norm,
                expected,
                found,
            } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(ErrorResponse {
                    error: message,
                    code,
                    frame,
                    index,
                    norm,
                    expected,
                    found,
                }),
            ),
            ApiError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: msg,
                    code: ErrorCode::Internal,
                    frame: None,
                    index: None,
                    norm: None,
                    expected: None,
                    found: None,
                }),
            ),
        };

        (status, body).into_response()
    }
}

impl From<SceneError> for ApiError {
    fn from(e: SceneError) -> Self {
        // Capture the message before destructuring to avoid partial-move issues
        let msg = e.to_string();
        match e {
            SceneError::MissingWorld => ApiError::Validation {
                message: msg,
                code: ErrorCode::MissingWorld,
                frame: None,
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::MissingFrame(id) => ApiError::Validation {
                message: msg,
                code: ErrorCode::MissingFrame,
                frame: Some(id),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::DuplicateId { id } => ApiError::Validation {
                message: msg,
                code: ErrorCode::DuplicateId,
                frame: Some(id),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::BrokenTopology { frame } => ApiError::Validation {
                message: msg,
                code: ErrorCode::BrokenTopology,
                frame: Some(frame),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::NonFiniteValue { frame } => ApiError::Validation {
                message: msg,
                code: ErrorCode::NonFiniteValue,
                frame: Some(frame),
                index: None,
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::InvalidQuaternion { frame, norm } => ApiError::Validation {
                message: msg,
                code: ErrorCode::InvalidQuaternion,
                frame: Some(frame),
                index: None,
                norm: Some(norm),
                expected: None,
                found: None,
            },
            SceneError::OrphanLink { index } => ApiError::Validation {
                message: msg,
                code: ErrorCode::OrphanLink,
                frame: None,
                index: Some(index),
                norm: None,
                expected: None,
                found: None,
            },
            SceneError::TwistsMismatch { expected, found } => ApiError::Validation {
                message: msg,
                code: ErrorCode::TwistsMismatch,
                frame: None,
                index: None,
                norm: None,
                expected: Some(expected),
                found: Some(found),
            },
        }
    }
}
