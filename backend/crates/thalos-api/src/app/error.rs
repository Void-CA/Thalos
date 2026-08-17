use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::app::dto::ErrorResponse;

pub enum ApiError {
    NotFound { message: String },

    /// 404 with a feature-specific machine-readable code (e.g.
    /// `DEMO_NOT_FOUND` for the demos catalog, design D10 error table).
    NotFoundWithCode { message: String, code: String },

    /// 400 — backend-management failures carrying a machine-readable code
    /// (resilience-presentation PR2a: `no_firmware`, `port_in_use`,
    /// `not_connected`, `connection_lost`).
    BadRequest { message: String, code: String },

    Validation { message: String, code: String },

    Conflict { message: String, code: String },

    InvalidState { message: String, code: String },

    Unsupported { message: String, code: String },

    Internal { message: String },
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::NotFound { message } => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: message,
                    code: "not_found".into(),
                }),
            ),

            ApiError::NotFoundWithCode { message, code } => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse { error: message, code }),
            ),

            ApiError::BadRequest { message, code } => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: message, code }),
            ),

            ApiError::Validation { message, code } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(ErrorResponse {
                    error: message,
                    code,
                }),
            ),

            ApiError::Conflict { message, code } => (
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: message,
                    code,
                }),
            ),

            ApiError::InvalidState { message, code } => (
                StatusCode::PRECONDITION_FAILED,
                Json(ErrorResponse {
                    error: message,
                    code,
                }),
            ),

            ApiError::Unsupported { message, code } => (
                StatusCode::NOT_IMPLEMENTED,
                Json(ErrorResponse {
                    error: message,
                    code,
                }),
            ),

            ApiError::Internal { message } => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: message,
                    code: "internal".into(),
                }),
            ),
        }
        .into_response()
    }
}
