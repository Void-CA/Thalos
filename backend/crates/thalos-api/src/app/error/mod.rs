use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::app::dto::ErrorResponse;


#[derive(Debug)]
pub enum ApiError {
    NotFound {
        message: String,
    },

    Validation {
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
