//! Lowering error types.
//!
//! `LoweringError` is returned when lowering fails due to invalid input or
//! backend-specific constraints. Rust's exhaustive match on `PlannedOperation`
//! and `MotionStrategy` guarantees all lowering rules are handled at compile
//! time — no `UnsupportedStrategy`-style runtime errors.

use thiserror::Error;

/// Errors that can occur during lowering.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum LoweringError {
    /// The home pose was not provided or is unreachable.
    ///
    /// Returned when a `PlannedOperation::Home` is encountered but
    /// `PlannedProgram::home_pose` is `None`.
    #[error("invalid home pose: {0}")]
    InvalidHomePose(String),

    /// A backend-specific constraint was violated.
    ///
    /// Reserved for future SCARA workspace boundary checks or other
    /// backend-specific validation rules.
    #[error("backend constraint violated: {0}")]
    BackendConstraintViolation(String),
}
