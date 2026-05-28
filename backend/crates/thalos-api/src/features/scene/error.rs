use crate::app::error::ApiError;

use thalos_visual::SceneError;

impl From<SceneError> for ApiError {
    fn from(e: SceneError) -> Self {
        match e {
            SceneError::MissingWorld => ApiError::Validation {
                message: e.to_string(),
                code: "missing_world".into(),
            },

            SceneError::MissingFrame(_) => ApiError::Validation {
                message: e.to_string(),
                code: "missing_frame".into(),
            },

            SceneError::DuplicateId { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "duplicate_id".into(),
            },

            SceneError::BrokenTopology { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "broken_topology".into(),
            },

            SceneError::NonFiniteValue { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "non_finite_value".into(),
            },

            SceneError::InvalidQuaternion { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "invalid_quaternion".into(),
            },

            SceneError::OrphanLink { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "orphan_link".into(),
            },

            SceneError::TwistsMismatch { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "twists_mismatch".into(),
            },
        }
    }
}
