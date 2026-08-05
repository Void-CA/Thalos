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
            RuntimeError::Ik(e) => ApiError::Validation {
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
            // Design D5: the scene-writeback surface is feature-flagged. A
            // disabled flag is a configuration conflict, not a bad request.
            RuntimeError::FeatureDisabled { feature } => ApiError::Conflict {
                message: format!("feature is disabled: {feature}"),
                code: code.into(),
            },
            RuntimeError::InvalidCompiledPlan { reason } => ApiError::Validation {
                message: format!("invalid compiled plan: {reason}"),
                code: code.into(),
            },
            // Spec command-endpoints "Undo with empty history": undo with no
            // applied commands is a state conflict, not a bad request.
            RuntimeError::EmptyCommandHistory => ApiError::Conflict {
                message: "no applied command to undo".to_string(),
                code: code.into(),
            },
            // R4-001: the active plan no longer matches the command's
            // pre-state (re-scheduled by a non-commanded path) — applying the
            // stale inverse would corrupt the plan. State conflict, 409.
            RuntimeError::StaleUndo => ApiError::Conflict {
                message: "stale undo: the active plan was replaced by a path that is not the command's pre-state".to_string(),
                code: code.into(),
            },
        }
    }
}
