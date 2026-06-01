use crate::app::error::ApiError;

use thalos_core::models::RobotModelError;
use thalos_runtime::RuntimeError;

impl From<RuntimeError> for ApiError {
    fn from(e: RuntimeError) -> Self {
        match e {
            RuntimeError::Scene(e) => match e {
                thalos_visual::SceneError::MissingWorld => ApiError::Validation {
                    message: e.to_string(),
                    code: "MISSING_WORLD".into(),
                },

                thalos_visual::SceneError::MissingFrame(_) => ApiError::Validation {
                    message: e.to_string(),
                    code: "MISSING_FRAME".into(),
                },

                thalos_visual::SceneError::DuplicateId { .. } => ApiError::Conflict {
                    message: e.to_string(),
                    code: "DUPLICATE_ID".into(),
                },

                thalos_visual::SceneError::BrokenTopology { .. } => ApiError::InvalidState {
                    message: e.to_string(),
                    code: "BROKEN_TOPOLOGY".into(),
                },

                thalos_visual::SceneError::NonFiniteValue { .. } => ApiError::Validation {
                    message: e.to_string(),
                    code: "NON_FINITE_VALUE".into(),
                },

                thalos_visual::SceneError::InvalidQuaternion { .. } => ApiError::Validation {
                    message: e.to_string(),
                    code: "INVALID_QUATERNION".into(),
                },

                thalos_visual::SceneError::OrphanLink { .. } => ApiError::Conflict {
                    message: e.to_string(),
                    code: "ORPHAN_LINK".into(),
                },

                thalos_visual::SceneError::TwistsMismatch { .. } => ApiError::Validation {
                    message: e.to_string(),
                    code: "TWISTS_MISMATCH".into(),
                },
            },

            RuntimeError::RobotModel(e) => match e {
                RobotModelError::InvalidRobotId { .. } => ApiError::NotFound {
                    message: e.to_string(),
                },

                RobotModelError::ModelSpecMismatch { .. } => ApiError::Internal {
                    message: e.to_string(),
                },
            },
        }
    }
}
