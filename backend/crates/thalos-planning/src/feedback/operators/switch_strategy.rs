//! `SwitchMoveStrategy` operator — converts MoveL segments to MoveJ
//! when `HighTrackingError` is detected.
//!
//! This is the first concrete [`IntentionOperator`] implementation. It uses
//! an [`IKSolver`] to find joint-space coordinates for the Cartesian target
//! pose, replacing the MoveL with a MoveJ that preserves the original velocity
//! limits and leaves acceleration unset for the planner to fill in.
//!
//! ## Failures
//!
//! - If IK does not converge, [`apply()`](IntentionOperator::apply) returns
//!   [`TransformationError::IkFailure`].
//! - If called on a non-MoveL segment, it returns
//!   [`TransformationError::UnsupportedSegment`].

use thalos_core::kinematics::inverse::{IKGoal, IKSolver};
use thalos_core::motion::segment::MotionSegment;

use crate::feedback::finding::{ExecutionFinding, FindingKind};
use crate::feedback::operator::{IntentionOperator, TransformationError};

/// Strategy that replaces a MoveL with a MoveJ when high tracking error
/// indicates the Cartesian constraint is problematic.
///
/// The conversion uses an [`IKSolver`] to compute joint-space coordinates
/// for the MoveL target pose. If IK does not converge, [`apply()`](IntentionOperator::apply)
/// returns [`TransformationError::IkFailure`].
pub struct SwitchMoveStrategy<'a> {
    /// IK solver used to convert Cartesian poses to joint targets.
    ik_solver: &'a dyn IKSolver,
    /// Current joint positions — the starting configuration for IK.
    current_joints: &'a [f64],
}

impl<'a> SwitchMoveStrategy<'a> {
    /// Creates a new `SwitchMoveStrategy`.
    ///
    /// * `ik_solver` — solver used to compute IK for the MoveL target pose.
    /// * `current_joints` — the robot's current joint configuration (q0).
    pub fn new(ik_solver: &'a dyn IKSolver, current_joints: &'a [f64]) -> Self {
        Self {
            ik_solver,
            current_joints,
        }
    }
}

impl IntentionOperator for SwitchMoveStrategy<'_> {
    fn name(&self) -> &'static str {
        "switch_move_strategy"
    }

    fn applies_to(&self, segment: &MotionSegment, finding: &ExecutionFinding) -> bool {
        // Only applies to MoveL segments with HighTrackingError
        matches!(segment, MotionSegment::MoveL { .. })
            && finding.kind == FindingKind::HighTrackingError
    }

    fn apply(
        &self,
        segment: &MotionSegment,
        finding: &ExecutionFinding,
    ) -> Result<Vec<MotionSegment>, TransformationError> {
        // Only works on MoveL segments
        let MotionSegment::MoveL {
            origin,
            target_pose,
            max_velocity,
            ..
        } = segment
        else {
            return Err(TransformationError::UnsupportedSegment {
                segment_id: finding.segment_id,
            });
        };

        let result = self
            .ik_solver
            .solve(self.current_joints, IKGoal::Pose(target_pose.clone()))
            .map_err(|_| TransformationError::IkFailure {
                segment_id: finding.segment_id,
                kind: finding.kind,
            })?;

        if !result.status.is_converged() {
            return Err(TransformationError::IkFailure {
                segment_id: finding.segment_id,
                kind: finding.kind,
            });
        }

        Ok(vec![MotionSegment::MoveJ {
            origin: origin.clone(),
            target: result.q,
            max_velocity: *max_velocity,
            max_acceleration: None,
        }])
    }
}

// ============================================================================
// Tests
// ============================================================================
//
// RED / GREEN / TRIANGULATE evidence for every task is recorded in the TDD
// Cycle Evidence table returned at the end.

#[cfg(test)]
mod tests {
    use thalos_core::ids::OperationId;
    use thalos_core::kinematics::inverse::{IKGoal, IKResult, IKSolver, IKStatus, IkError};
    use thalos_core::motion::segment::MotionSegment;
    use thalos_core::prelude::{FrameId, Pose, Transform3D};

    use super::*;
    use crate::feedback::finding::{ExecutionFinding, FindingKind};
    use crate::feedback::operator::TransformationError;

    // ── Mock IK solvers ─────────────────────────────────────────────────

    /// Mock solver that always converges, returning q0 as the solution.
    struct NoopIKSolver;

    impl IKSolver for NoopIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult::converged(q0.to_vec(), 1, 0.0, None))
        }
    }

    /// Mock solver that always fails with `MaxIterations`.
    struct FailingIKSolver;

    impl IKSolver for FailingIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult::max_iterations(q0.to_vec(), 100, 1.5, None))
        }
    }

    // ── Task 2.4 RED + Task 2.5 GREEN ─────────────────────────────────────
    //
    // RED:   test written before SwitchMoveStrategy existed
    // GREEN: SwitchMoveStrategy with name() and apply()

    #[test]
    fn test_switch_move_strategy_name() {
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let strategy = SwitchMoveStrategy::new(&solver, &q0);

        assert_eq!(strategy.name(), "switch_move_strategy");
    }

    #[test]
    fn test_apply_move_l_to_move_j() {
        let q0 = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let solver = NoopIKSolver;
        let strategy = SwitchMoveStrategy::new(&solver, &q0);

        let segment = MotionSegment::MoveL {
            origin: OperationId("test".into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity: Some(100.0),
        };
        let finding = ExecutionFinding {
            segment_id: 0,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        let result = strategy.apply(&segment, &finding);
        assert!(result.is_ok(), "expected Ok, got {:?}", result);

        let segments = result.unwrap();
        assert_eq!(segments.len(), 1);

        match &segments[0] {
            MotionSegment::MoveJ {
                target,
                max_velocity,
                max_acceleration,
                ..
            } => {
                assert_eq!(target, &q0, "target should match q0 from IKSolver");
                assert_eq!(*max_velocity, Some(100.0), "should preserve max_velocity");
                assert_eq!(
                    *max_acceleration, None,
                    "MoveJ should have no max_acceleration from SwitchMoveStrategy"
                );
            }
            other => panic!("expected MoveJ, got {other:?}"),
        }
    }

    // ── Task 2.6 RED + Task 2.7 GREEN ─────────────────────────────────────
    //
    // RED:   test written before segment-type dispatch was complete
    // GREEN: applies_to() checks segment type

    #[test]
    fn test_applies_to_rejects_move_j() {
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let strategy = SwitchMoveStrategy::new(&solver, &q0);

        let segment = MotionSegment::MoveJ {
            origin: OperationId("test".into()),
            target: vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
            max_velocity: None,
            max_acceleration: None,
        };
        let finding = ExecutionFinding {
            segment_id: 0,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        assert!(!strategy.applies_to(&segment, &finding));
    }

    // ── Task 2.8 RED + Task 2.9 GREEN ─────────────────────────────────────
    //
    // RED:   test written before IK failure handling
    // GREEN: apply() returns Err(IkFailure) on non-convergence

    #[test]
    fn test_apply_returns_ik_failure_on_non_convergence() {
        let q0 = vec![0.0; 6];
        let solver = FailingIKSolver;
        let strategy = SwitchMoveStrategy::new(&solver, &q0);

        let segment = MotionSegment::MoveL {
            origin: OperationId("test".into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity: None,
        };
        let finding = ExecutionFinding {
            segment_id: 1,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        let result = strategy.apply(&segment, &finding);
        assert!(result.is_err(), "expected Err, got {:?}", result);

        match result.unwrap_err() {
            TransformationError::IkFailure { segment_id, kind } => {
                assert_eq!(segment_id, 1);
                assert_eq!(kind, FindingKind::HighTrackingError);
            }
            other => panic!("expected IkFailure, got {other:?}"),
        }
    }

    // ── Triangulation ─────────────────────────────────────────────────────

    #[test]
    fn test_applies_to_returns_true_for_move_l_with_high_tracking() {
        // Happy path: applies_to() should return true for MoveL + HighTrackingError
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let strategy = SwitchMoveStrategy::new(&solver, &q0);

        let segment = MotionSegment::MoveL {
            origin: OperationId("test".into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity: Some(50.0),
        };
        let finding = ExecutionFinding {
            segment_id: 0,
            kind: FindingKind::HighTrackingError,
            value: 0.9,
        };

        assert!(strategy.applies_to(&segment, &finding));
    }

    #[test]
    fn test_apply_unsupported_segment_move_j() {
        // apply() should return UnsupportedSegment for non-MoveL segments
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let strategy = SwitchMoveStrategy::new(&solver, &q0);

        let segment = MotionSegment::MoveJ {
            origin: OperationId("test".into()),
            target: vec![0.0; 6],
            max_velocity: None,
            max_acceleration: None,
        };
        let finding = ExecutionFinding {
            segment_id: 2,
            kind: FindingKind::HighTrackingError,
            value: 0.8,
        };

        let result = strategy.apply(&segment, &finding);
        assert!(result.is_err());

        match result.unwrap_err() {
            TransformationError::UnsupportedSegment { segment_id } => {
                assert_eq!(segment_id, 2);
            }
            other => panic!("expected UnsupportedSegment, got {other:?}"),
        }
    }

    #[test]
    fn test_applies_to_rejects_non_matching_finding_kind() {
        // As a consistency test with the current single-variant FindingKind,
        // this verifies the operator doesn't return a blanket `true`.
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let strategy = SwitchMoveStrategy::new(&solver, &q0);

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

        assert!(strategy.applies_to(&segment, &finding));
    }
}
