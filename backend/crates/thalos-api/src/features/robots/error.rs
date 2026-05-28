use crate::app::error::ApiError;

use thalos_core::models::RobotModelError;

impl From<RobotModelError> for ApiError {
    fn from(e: RobotModelError) -> Self {
        match e {
            RobotModelError::InvalidRobotId { .. } => ApiError::NotFound {
                message: e.to_string(),
            },

            RobotModelError::ModelSpecMismatch { .. } => ApiError::Internal {
                message: e.to_string(),
            },
        }
    }
}
