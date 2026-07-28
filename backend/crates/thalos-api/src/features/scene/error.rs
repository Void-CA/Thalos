use crate::app::error::ApiError;

use thalos_runtime::RuntimeError;

impl From<RuntimeError> for ApiError {
    fn from(e: RuntimeError) -> Self {
        let code = e.error_code();

        match e {
            RuntimeError::RobotModel(e) => ApiError::Validation {
                message: e.to_string(),
                code: code.into(),
            },
            RuntimeError::Workspace(e) => ApiError::Validation {
                message: e.to_string(),
                code: code.into(),
            },
            RuntimeError::Planning(e) => ApiError::Validation {
                message: e.to_string(),
                code: code.into(),
            },
            RuntimeError::JointCountMismatch { expected, received } => ApiError::Validation {
                message: format!("joint count mismatch: expected {expected}, got {received}"),
                code: code.into(),
            },
            RuntimeError::ToolFrameNotFound { frame_id } => ApiError::Validation {
                message: format!(
                    "tool frame not found: frame {frame_id} does not exist in the robot chain"
                ),
                code: code.into(),
            },
        }
    }
}
