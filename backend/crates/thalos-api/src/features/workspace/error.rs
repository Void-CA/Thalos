//! Maps `WorkspaceError` from `thalos_core` to `ApiError` HTTP responses.

use thalos_core::analysis::workspace::WorkspaceError;

use crate::app::error::ApiError;

impl From<WorkspaceError> for ApiError {
    fn from(e: WorkspaceError) -> Self {
        match e {
            WorkspaceError::InvalidSampleCount(_) => ApiError::Validation {
                message: e.to_string(),
                code: "invalid_sample_count".into(),
            },
            WorkspaceError::InvalidTolerance(_) => ApiError::Validation {
                message: e.to_string(),
                code: "invalid_tolerance".into(),
            },
            WorkspaceError::InvalidPoint(_) => ApiError::Validation {
                message: e.to_string(),
                code: "invalid_point".into(),
            },
            WorkspaceError::EmptyWorkspace => ApiError::Internal {
                message: e.to_string(),
            },
        }
    }
}
