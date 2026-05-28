use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::app::dto::ErrorResponse;


pub enum ApiError {
    NotFound {
        message: String,
    },

    Validation {
        message: String,
        code: String,
    },

    Conflict {
        message: String,
        code: String,
    },

    InvalidState {
        message: String,
        code: String,
    },

    Unsupported {
        message: String,
        code: String,
    },

    Internal {
        message: String,
    },
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
