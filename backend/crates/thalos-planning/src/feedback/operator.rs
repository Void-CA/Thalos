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
//!
//! ## Observation-based operators (PR 4b)
//!
//! The same module hosts the new-model
//! [`ObservationIntentionOperator`] trait and the [`ActionProposal`]
//! type: operators over the unified [`Observation`] vocabulary that
//! produce remediation proposals instead of transformed segments. The
//! legacy [`IntentionOperator`] stays live until PR 4d.

use std::collections::BTreeMap;
use std::fmt;

use thalos_core::analysis::action::{Action, ActionId, ActionImpact, ActionKind, ActionPriority};
use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::analysis::observation::{Observation, ObservationId};
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
// Observation-based operators (PR 4b — new model)
// ============================================================================

/// Proposal for a remediation action over the observation model (spec I5).
///
/// This is the "operator modeled as action" intermediate type: an operator
/// produces [`ActionProposal`]s that reference an observation by id, WITHOUT
/// fabricating an [`ActionId`]. Assigning ids is the aggregator's job
/// (1..=n during report construction) — operators never hardcode them
/// (PR 4a gotcha).
///
/// The proposal exists because operators must not mutate observations (C4)
/// and must not claim an identity they do not own; it represents an
/// *intention*, not a plan modification (C3).
#[derive(Debug, Clone, PartialEq)]
pub struct ActionProposal {
    /// The remediation kind (e.g. [`ActionKind::SwitchMoveStrategy`]).
    pub kind: ActionKind,
    /// The observation this proposal remediates (I5).
    pub target_observation: ObservationId,
    /// Scheduling priority of the remediation.
    pub priority: ActionPriority,
    /// Expected impact on the artifact's quality.
    pub impact: ActionImpact,
    /// Typed parameters for the remediation (stable keys, D5).
    pub parameters: BTreeMap<String, AttributeValue>,
}

impl ActionProposal {
    /// Materializes the proposal into a full [`Action`] with a caller-owned id.
    ///
    /// The id is supplied by the consumer (the aggregator assigns 1..=n) —
    /// the proposal itself carries no identity, so operators cannot hardcode
    /// ids.
    pub fn materialize(&self, id: ActionId) -> Action {
        Action {
            id,
            kind: self.kind,
            target_observation: self.target_observation,
            priority: self.priority,
            impact: self.impact,
            parameters: self.parameters.clone(),
        }
    }
}

/// Intention operator over the unified observation model (PR 4b).
///
/// The new-model counterpart of the legacy [`IntentionOperator`] (which keeps
/// operating on [`ExecutionFinding`](crate::feedback::finding::ExecutionFinding)
/// until PR 4d). It consumes ONLY [`Observation`] — it has zero knowledge of
/// `ExecutionFinding`, `Finding` or `Recommendation` (C1) — and produces
/// [`ActionProposal`]s (C3).
///
/// # Contract
///
/// - `name()` returns a `&'static str` for logging/metrics.
/// - `applies_to()` is a pure predicate over the phenomenon — implementations
///   key their rules on [`ObservationKind`], never on attribute values (C2).
/// - `apply()` returns zero or more [`ActionProposal`]s. It NEVER mutates the
///   observation (C4) and never modifies the plan — the proposal is an
///   intention, not a command (C3).
///
/// Implementations must be [`Send`] + [`Sync`] so a registry can hold them
/// behind `&dyn ObservationIntentionOperator`.
///
/// [ObservationKind]: thalos_core::analysis::observation::ObservationKind
pub trait ObservationIntentionOperator: Send + Sync {
    /// Human-readable operator name for logging and metrics.
    fn name(&self) -> &'static str;

    /// Whether this operator addresses the given observation's phenomenon.
    fn applies_to(&self, observation: &Observation) -> bool;

    /// Produce remediation proposals for the given observation.
    ///
    /// Returns an empty vec when no proposal applies (mirroring the legacy
    /// "no alternative exists" semantics). The observation is left untouched.
    fn apply(&self, observation: &Observation) -> Vec<ActionProposal>;
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

    // ── Task 4.3 RED + Task 4.4 GREEN: Observation-based IntentionOperator ──
    //
    // RED:   tests written before ObservationIntentionOperator / ActionProposal
    //        existed (compile-time failure — E0433/E0412: types absent)
    // GREEN: trait + ActionProposal created in this module

    use std::collections::BTreeMap;
    use thalos_core::analysis::action::{
        Action, ActionId, ActionImpact, ActionKind, ActionPriority,
    };
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{
        ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
    };
    use thalos_core::analysis::report::{AnalysisReport, ReportError};
    use thalos_core::analysis::summary::{AnalysisSummary, Grade};
    use thalos_core::ids::{ExecutionSessionId, MotionPlanId};

    /// An execution-domain observation (feedback loop vocabulary).
    fn execution_observation(id: u32, kind: ObservationKind, causes: Vec<u32>) -> Observation {
        Observation {
            id: ObservationId(id),
            kind,
            severity: Severity::Error,
            artifact: ArtifactRef::ExecutionSession(ExecutionSessionId("e1".to_string())),
            location: Location::Timestamp(400),
            attributes: BTreeMap::new(),
            causes: causes.into_iter().map(ObservationId).collect(),
            related: Vec::new(),
        }
    }

    /// A plan-domain observation.
    fn plan_observation(id: u32, kind: ObservationKind) -> Observation {
        Observation {
            id: ObservationId(id),
            kind,
            severity: Severity::Warning,
            artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
            location: Location::Waypoint(0),
            attributes: BTreeMap::new(),
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    fn summary() -> AnalysisSummary {
        AnalysisSummary {
            quality_index: 0.85,
            observation_count: 0,
            severity_distribution: BTreeMap::new(),
            grade: Grade::Good,
        }
    }

    /// Test operator over the NEW observation model.
    struct ObservationTestOperator;

    impl ObservationIntentionOperator for ObservationTestOperator {
        fn name(&self) -> &'static str {
            "observation_test_operator"
        }

        fn applies_to(&self, observation: &Observation) -> bool {
            matches!(observation.kind, ObservationKind::TrackingError)
        }

        fn apply(&self, observation: &Observation) -> Vec<ActionProposal> {
            vec![ActionProposal {
                kind: ActionKind::SwitchMoveStrategy,
                target_observation: observation.id,
                priority: ActionPriority::Medium,
                impact: ActionImpact::Medium,
                parameters: BTreeMap::new(),
            }]
        }
    }

    #[test]
    fn observation_operator_contract_is_observation_only() {
        // C1: the new trait consumes `&Observation` exclusively — no
        // ExecutionFinding / FindingKind / Recommendation appears anywhere in
        // the contract (enforced at compile time by the signatures above).
        let op = ObservationTestOperator;
        let obs = execution_observation(1, ObservationKind::TrackingError, vec![]);

        assert_eq!(op.name(), "observation_test_operator");
        assert!(op.applies_to(&obs));
    }

    #[test]
    fn operator_apply_returns_proposal_targeting_observation() {
        // C3 + I5: apply() returns a proposal referencing the observation by
        // id — never a mutation (C4), never a plan modification.
        let op = ObservationTestOperator;
        let obs = execution_observation(7, ObservationKind::TrackingError, vec![]);

        let proposals = op.apply(&obs);
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].kind, ActionKind::SwitchMoveStrategy);
        assert_eq!(proposals[0].target_observation, obs.id);
        // The observation remains the same fact — the operator only borrows it.
        assert_eq!(obs.id, ObservationId(7));
        assert_eq!(obs.kind, ObservationKind::TrackingError);
    }

    #[test]
    fn action_proposal_has_no_id_and_materializes_with_caller_id() {
        // ActionId gotcha (PR 4a): the operator must not fabricate ids — the
        // proposal carries none; the aggregator assigns 1..=n at materialization.
        let proposal = ActionProposal {
            kind: ActionKind::SwitchMoveStrategy,
            target_observation: ObservationId(3),
            priority: ActionPriority::High,
            impact: ActionImpact::High,
            parameters: BTreeMap::new(),
        };

        let action: Action = proposal.materialize(ActionId(9));
        assert_eq!(action.id, ActionId(9));
        assert_eq!(action.kind, ActionKind::SwitchMoveStrategy);
        assert_eq!(action.target_observation, ObservationId(3));
    }

    #[test]
    fn feedback_observation_may_be_caused_by_plan_observation() {
        // C5 / I4 direction: F.causes=[P] (feedback → plan) is accepted.
        let report = AnalysisReport {
            artifact: ArtifactRef::ExecutionSession(ExecutionSessionId("e1".to_string())),
            observations: vec![
                plan_observation(1, ObservationKind::NearSingularity),
                execution_observation(2, ObservationKind::TrackingError, vec![1]),
            ],
            actions: Vec::new(),
            metrics: BTreeMap::new(),
            summary: summary(),
        };
        assert_eq!(report.validate(), Ok(()));
    }

    #[test]
    fn plan_observation_must_not_be_caused_by_feedback() {
        // C5 / I4 negative: P.causes=[F] (plan → feedback) is rejected.
        let mut report = AnalysisReport {
            artifact: ArtifactRef::ExecutionSession(ExecutionSessionId("e1".to_string())),
            observations: vec![
                plan_observation(1, ObservationKind::NearSingularity),
                execution_observation(2, ObservationKind::TrackingError, vec![]),
            ],
            actions: Vec::new(),
            metrics: BTreeMap::new(),
            summary: summary(),
        };
        report.observations[0].causes = vec![ObservationId(2)];

        let err = report
            .validate()
            .expect_err("P.causes=[F] must be rejected");
        assert!(matches!(
            err,
            ReportError::DirectionViolation {
                from: ObservationId(1),
                target: ObservationId(2),
            }
        ));
    }
}
