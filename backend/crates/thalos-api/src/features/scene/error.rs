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
            // PR2: a concurrent mutation bumped the history version between
            // the atomic peek and the commit — the undo target moved. State
            // conflict, 409 (spec command-endpoints "Undo version mismatch").
            RuntimeError::UndoVersionMismatch { expected, actual } => ApiError::Conflict {
                message: format!("undo version mismatch: expected {expected}, got {actual}"),
                code: code.into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    #[test]
    fn undo_version_mismatch_maps_to_conflict_409_with_code() {
        // Spec command-endpoints "Undo version mismatch" → 409 with code
        // `undo_version_mismatch`. The mapped ApiError must be a Conflict that
        // carries BOTH versions (for the operator to see the drift) and the
        // machine-readable code the frontend branches on.
        let api: ApiError = RuntimeError::UndoVersionMismatch {
            expected: 3,
            actual: 5,
        }
        .into();

        let (message, code) = match &api {
            ApiError::Conflict { message, code } => (message.as_str(), code.as_str()),
            _ => panic!("undo version mismatch must map to ApiError::Conflict (409)"),
        };
        assert_eq!(code, "undo_version_mismatch", "409 body code must match");
        assert!(
            message.contains('3') && message.contains('5'),
            "the 409 message must name both the expected and the actual version: {message}"
        );

        let response = api.into_response();
        assert_eq!(
            response.status(),
            StatusCode::CONFLICT,
            "the mapped Conflict must answer HTTP 409"
        );
    }
}
