//! Intention operator contract over the unified observation model.
//!
//! Defines the [`ObservationIntentionOperator`] trait that all operators
//! implement and the [`ActionProposal`] type operators produce.
//!
//! ## Trait Contract
//!
//! - `name()` returns a human-readable static string for logging/metrics.
//! - `applies_to()` is a pure predicate over the phenomenon.
//! - `apply()` produces zero or more [`ActionProposal`]s — never mutations of
//!   the observation, never plan modifications.
//!
//! Operators are pure proposers: they decide WHAT remediation an observation
//! warrants. The HOW (proposal → concrete [`MotionSegment`]s) is the
//! [`ProposalMaterializer`](crate::feedback::materializer::ProposalMaterializer)'s
//! job, orchestrated by
//! [`FeedbackOrchestrator`](crate::feedback::orchestrator::FeedbackOrchestrator)
//! (PR 4d).
//!
//! ## Legacy removal (PR 4d, task 4.6)
//!
//! The old `IntentionOperator` trait over `ExecutionFinding` (which returned
//! transformed segments directly) was removed in PR 4d: operators no longer
//! touch [`MotionSegment`]s or legacy findings. Its segment logic was
//! generalized onto the proposal vocabulary in `feedback/materializer.rs`.

use std::collections::BTreeMap;

use thalos_core::analysis::action::{Action, ActionId, ActionImpact, ActionKind, ActionPriority};
use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::analysis::observation::{Observation, ObservationId};

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
/// The new-model operator trait. It consumes ONLY [`Observation`] — it has zero
/// knowledge of `ExecutionFinding`, `Finding` or `Recommendation` (C1) — and
/// produces [`ActionProposal`]s (C3).
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
    use super::*;

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
        // C1: the trait consumes `&Observation` exclusively — no
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
