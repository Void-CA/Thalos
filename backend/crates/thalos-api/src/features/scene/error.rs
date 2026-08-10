use crate::app::error::ApiError;

use thalos_runtime::error::ControllerError;
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
            // S8: a Repeat start without a compiled/active plan has nothing to
            // re-execute — 400 before any controller traffic.
            RuntimeError::NoActivePlan => ApiError::BadRequest {
                message: "no active plan to execute".to_string(),
                code: "no_active_plan".into(),
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
            // R4-001: a controller-level failure keeps its REAL code. State
            // conflicts (not_connected / connection_lost / already_connected)
            // are 409 so the frontend can branch on the code and offer the
            // reconnect CTA instead of a silent 200.
            RuntimeError::ControllerFailed { source } => match source {
                ControllerError::NotFound(_) => ApiError::NotFound {
                    message: source.to_string(),
                },
                ControllerError::NotConnected
                | ControllerError::AlreadyConnected
                | ControllerError::ConnectionLost => ApiError::Conflict {
                    message: source.to_string(),
                    code: source.error_code().into(),
                },
                _ => ApiError::BadRequest {
                    message: source.to_string(),
                    code: source.error_code().into(),
                },
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

    /// R4-001: a `ControllerFailed(ConnectionLost)` runtime error must surface
    /// as HTTP 409 with the real `connection_lost` code — the frontend tick
    /// loop keys on it to offer the Reconectar CTA.
    #[test]
    fn controller_failed_connection_lost_maps_to_conflict_409_with_connection_lost_code() {
        let api: ApiError = RuntimeError::ControllerFailed {
            source: ControllerError::ConnectionLost,
        }
        .into();

        let code = match &api {
            ApiError::Conflict { message, code } => {
                assert_eq!(message, "connection to the execution backend was lost");
                code.as_str()
            }
            _ => panic!("ControllerFailed(ConnectionLost) must map to ApiError::Conflict (409)"),
        };
        assert_eq!(code, "connection_lost");

        let response = api.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    /// R4-001: a `ControllerFailed(NotConnected)` runtime error (start with an
    /// active-but-not-connected hardware backend) must surface as HTTP 409
    /// with the real `not_connected` code — NOT a silent 200.
    #[test]
    fn controller_failed_not_connected_maps_to_conflict_409_with_not_connected_code() {
        let api: ApiError = RuntimeError::ControllerFailed {
            source: ControllerError::NotConnected,
        }
        .into();

        let code = match &api {
            ApiError::Conflict { message, code } => {
                assert_eq!(message, "controller is not connected");
                code.as_str()
            }
            _ => panic!("ControllerFailed(NotConnected) must map to ApiError::Conflict (409)"),
        };
        assert_eq!(code, "not_connected");

        let response = api.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
}
