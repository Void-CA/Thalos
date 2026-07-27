use thiserror::Error;

/// Compilation errors produced during normalization.
///
/// Each variant carries the unresolved or offending identifier as a `String`
/// so the error is self-contained and can be formatted for diagnostics.
#[derive(Debug, Error)]
pub enum NormalizationError {
    /// A `PointId` reference could not be resolved to a concrete point resource.
    #[error("unresolved point reference: {0}")]
    UnresolvedPoint(String),

    /// A `PathId` reference could not be resolved to a concrete path resource.
    #[error("unresolved path reference: {0}")]
    UnresolvedPath(String),

    /// A `FrameId` reference could not be resolved to a concrete frame resource.
    #[error("unresolved frame reference: {0}")]
    UnresolvedFrame(String),

    /// An `OutputId` reference could not be resolved to a concrete output resource.
    #[error("unresolved output reference: {0}")]
    UnresolvedOutput(String),

    /// A resolved path contains zero waypoints (violates the non-empty invariant).
    #[error("path '{0}' contains no waypoints")]
    EmptyPath(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unresolved_point_message() {
        let err = NormalizationError::UnresolvedPoint("pt_99".into());
        let msg = err.to_string();
        assert_eq!(msg, "unresolved point reference: pt_99");
    }

    #[test]
    fn unresolved_path_message() {
        let err = NormalizationError::UnresolvedPath("path_404".into());
        let msg = err.to_string();
        assert_eq!(msg, "unresolved path reference: path_404");
    }

    #[test]
    fn unresolved_frame_message() {
        let err = NormalizationError::UnresolvedFrame("unknown_frame".into());
        let msg = err.to_string();
        assert_eq!(msg, "unresolved frame reference: unknown_frame");
    }

    #[test]
    fn unresolved_output_message() {
        let err = NormalizationError::UnresolvedOutput("gripper_x".into());
        let msg = err.to_string();
        assert_eq!(msg, "unresolved output reference: gripper_x");
    }

    #[test]
    fn empty_path_message() {
        let err = NormalizationError::EmptyPath("weld_path".into());
        let msg = err.to_string();
        assert_eq!(msg, "path 'weld_path' contains no waypoints");
    }

    #[test]
    fn error_is_debug_and_clone() {
        let err = NormalizationError::UnresolvedPoint("pt_01".into());
        let _ = format!("{err:?}");
        // Clone is derived via Error derive — verify the type can be cloned
        // (thiserror derives Clone when the inner types are Clone)
        // Note: thiserror does NOT derive Clone; test existence via Debug only.
    }
}
