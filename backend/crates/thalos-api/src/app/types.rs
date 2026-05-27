use axum::Json;

use crate::app::error::ApiError;

pub type ApiResult<T> = Result<Json<T>, ApiError>;
