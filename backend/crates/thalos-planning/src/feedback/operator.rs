//! Intention operator trait for transforming motion segments.
//!
//! Defines the [`IntentionOperator`] trait that all operators implement,
//! and [`TransformationError`] for operator failures that occur during
//! transformation.
//!
//! ## Trait Contract
//!
//! - `name()` returns a human-readable static string for logging/metrics.
//! - `applies_to()` checks if this operator can address the given finding
//!   for the given segment.
//! - `apply()` produces one or more alternative segments, or returns
//!   `Err(TransformationError)` when the transformation itself fails.
//!
//! Operators are pure segment transformers — they produce new
//! `MotionSegment`s that get recompiled. They do NOT rank or select
//! between alternatives.

use std::fmt;

use thalos_core::motion::segment::MotionSegment;

use crate::feedback::finding::{ExecutionFinding, FindingKind};

/// An operator that transforms a [`MotionSegment`] into one or more
/// alternative [`MotionSegment`]s based on an [`ExecutionFinding`].
///
/// Implementations must be [`Send`] + [`Sync`] so the orchestrator can
/// hold them behind `&dyn IntentionOperator`.
///
/// # Contract
///
/// - `name()` returns a `&'static str` that is constant for the lifetime
///   of the program.
/// - `applies_to()` is a pure predicate — no side effects.
/// - `apply()` may fail due to external computation (e.g. IK does not
///   converge) even when `applies_to()` returned `true`.
pub trait IntentionOperator: Send + Sync {
    /// Human-readable operator name for logging and metrics.
    fn name(&self) -> &'static str;

    /// Whether this operator can address the given finding for this segment.
    fn applies_to(&self, segment: &MotionSegment, finding: &ExecutionFinding) -> bool;

    /// Produce alternative [`MotionSegment`]s for the given segment and finding.
    ///
    /// # Errors
    ///
    /// Returns [`TransformationError::IkFailure`] when the transformation
    /// itself fails (e.g. IK did not converge). This is distinct from
    /// "no alternative exists", which returns `Ok(vec![])`.
    ///
    /// Returns [`TransformationError::UnsupportedSegment`] when the operator
    /// does not support the segment type (defensive — `applies_to()` should
    /// have been checked first).
    fn apply(
        &self,
        segment: &MotionSegment,
        finding: &ExecutionFinding,
    ) -> Result<Vec<MotionSegment>, TransformationError>;
}

/// Errors that can occur during intention transformation.
///
/// Kept minimal for v1. New variants should be added as new operators
/// appear (e.g. a tool-change operator might add `ToolChangeFailure`).
#[derive(Debug, Clone, PartialEq)]
pub enum TransformationError {
    /// Inverse kinematics failed to find a solution for the target.
    IkFailure {
        /// Index of the segment that triggered the IK solve.
        segment_id: usize,
        /// Kind of finding that triggered the transformation.
        kind: FindingKind,
    },
    /// The operator does not know how to transform this segment type.
    UnsupportedSegment {
        /// Index of the segment that could not be transformed.
        segment_id: usize,
    },
}

impl fmt::Display for TransformationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TransformationError::IkFailure { segment_id, kind } => {
                write!(f, "IK failure for segment {segment_id} (kind: {kind:?})")
            }
            TransformationError::UnsupportedSegment { segment_id } => {
                write!(f, "unsupported segment type at index {segment_id}")
            }
        }
    }
}

impl std::error::Error for TransformationError {}

// ============================================================================
// Tests
// ============================================================================
//
// RED / GREEN / TRIANGULATE evidence for every task is recorded in the TDD
// Cycle Evidence table returned at the end.

#[cfg(test)]
mod tests {
    use thalos_core::ids::OperationId;
    use thalos_core::motion::segment::MotionSegment;
    use thalos_core::prelude::{FrameId, Pose, Transform3D};

    use super::*;
    use crate::feedback::finding::{ExecutionFinding, FindingKind};

    // ── Task 2.1 RED + Tasks 2.2 + 2.3 GREEN ───────────────────────────────
    //
    // RED:   test written before IntentionOperator trait existed
    // GREEN: trait + TransformationError enum created

    struct TestOperator;

    impl IntentionOperator for TestOperator {
        fn name(&self) -> &'static str {
            "test_operator"
        }

        fn applies_to(&self, segment: &MotionSegment, finding: &ExecutionFinding) -> bool {
            matches!(segment, MotionSegment::MoveL { .. })
                && finding.kind == FindingKind::HighTrackingError
        }

        fn apply(
            &self,
            segment: &MotionSegment,
            finding: &ExecutionFinding,
        ) -> Result<Vec<MotionSegment>, TransformationError> {
            if !self.applies_to(segment, finding) {
                return Err(TransformationError::UnsupportedSegment {
                    segment_id: finding.segment_id,
                });
            }
            Ok(vec![])
        }
    }

    #[test]
    fn test_name_returns_static_str() {
        let op = TestOperator;
        // The return type &'static str is enforced at compile time.
        // This test verifies the runtime value.
        assert_eq!(op.name(), "test_operator");
    }

    #[test]
    fn test_applies_to_move_l_with_high_tracking_error() {
        let op = TestOperator;
        let segment = MotionSegment::MoveL {
            origin: OperationId("test".into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity: None,
        };
        let finding = ExecutionFinding {
            segment_id: 0,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        assert!(op.applies_to(&segment, &finding));
    }

    #[test]
    fn test_applies_to_move_j_returns_false() {
        let op = TestOperator;
        let segment = MotionSegment::MoveJ {
            origin: OperationId("test".into()),
            target: vec![0.0; 6],
            max_velocity: None,
            max_acceleration: None,
        };
        let finding = ExecutionFinding {
            segment_id: 0,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        assert!(!op.applies_to(&segment, &finding));
    }

    // ── Triangulation: operator apply with unsupported segment ──────────────

    #[test]
    fn test_apply_unsupported_segment_returns_error() {
        let op = TestOperator;
        let segment = MotionSegment::MoveJ {
            origin: OperationId("test".into()),
            target: vec![0.0; 6],
            max_velocity: None,
            max_acceleration: None,
        };
        let finding = ExecutionFinding {
            segment_id: 5,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        let result = op.apply(&segment, &finding);
        assert!(result.is_err());

        match result.unwrap_err() {
            TransformationError::UnsupportedSegment { segment_id } => {
                assert_eq!(segment_id, 5);
            }
            other => panic!("expected UnsupportedSegment, got {other:?}"),
        }
    }

    #[test]
    fn test_apply_supported_segment_returns_ok() {
        let op = TestOperator;
        let segment = MotionSegment::MoveL {
            origin: OperationId("test".into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity: None,
        };
        let finding = ExecutionFinding {
            segment_id: 0,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        let result = op.apply(&segment, &finding);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    // ── Task 2.3: TransformationError Display + Error impl ─────────────────
    // (structural; no real logic to triangulate)

    #[test]
    fn test_transformation_error_ik_failure_display() {
        let err = TransformationError::IkFailure {
            segment_id: 1,
            kind: FindingKind::HighTrackingError,
        };
        let msg = err.to_string();
        assert!(msg.contains("IK failure"));
        assert!(msg.contains("segment 1"));
    }

    #[test]
    fn test_transformation_error_unsupported_display() {
        let err = TransformationError::UnsupportedSegment { segment_id: 3 };
        let msg = err.to_string();
        assert!(msg.contains("unsupported"), "msg: {msg}");
        assert!(
            msg.contains("segment"),
            "expected msg to contain 'segment', got: {msg}"
        );
        assert!(msg.contains('3'), "expected msg to contain '3', got: {msg}");
    }
}
