//! ProposalMaterializer — translates [`ActionProposal`]s into concrete plan
//! modifications (PR 4d, task 4.6).
//!
//! ## Role in the feedback loop (architecture change, PR 4d)
//!
//! The loop now has two distinct decision layers, orchestrated by
//! [`FeedbackOrchestrator`](crate::feedback::orchestrator::FeedbackOrchestrator):
//!
//! ```text
//! Observation
//!     ↓  (ObservationIntentionOperator)
//! ActionProposal
//!     ↓  (ProposalMaterializer)   ← this module
//! MotionSegment
//! ```
//!
//! - The **operator decides WHAT** (phenomenon → proposal): kind-keyed rules,
//!   severity/priority/impact.
//! - The **materializer decides HOW** (proposal → plan modification): it is the
//!   only component that touches concrete [`MotionSegment`]s. It generalizes the
//!   legacy `switch_strategy` operator's segment logic (PR 2) onto the proposal
//!   vocabulary, and is the component the legacy operator's materialization
//!   responsibility was extracted into.
//!
//! The two never call each other — `run()` coordinates them.
//!
//! ## Phenomenon-blind contract (user contract C4)
//!
//! The materializer has **zero knowledge of phenomena**: no
//! [`ObservationKind`](thalos_core::analysis::observation::ObservationKind)
//! appears anywhere in this module. It reads only:
//!
//! - `proposal.kind` (which remediation) and `proposal.parameters` (how), and
//! - the target [`MotionSegment`] the caller resolved from the observation's
//!   plan address (`run()` owns that coordination step).
//!
//! ## Mapping: ActionProposal → MotionSegment
//!
//! | Proposal | Target segment | Replacement |
//! |---|---|---|
//! | `kind: SwitchMoveStrategy`, `parameters["strategy"] = "move_j"` | `MoveL` | `MoveJ` — IK solve of the target pose (`q0` start), preserving `origin` and `max_velocity`, `max_acceleration: None` (planner fills it) |
//! | any other `kind` / strategy | — | `Err(UnsupportedProposal)` |
//! | `SwitchMoveStrategy` + `move_j` | non-`MoveL` | `Err(UnsupportedSegment)` |
//!
//! `parameters["tracking_value"]` (the observed metric that triggered the
//! proposal) is carried for provenance and audit only — it does not change the
//! move conversion. `priority`/`impact`/`target_observation` are scheduling and
//! provenance metadata, never plan data.
//!
//! ## Failures
//!
//! - [`MaterializationError::IkFailure`] — IK did not converge on a joint
//!   solution for the target pose.
//! - [`MaterializationError::UnsupportedSegment`] — the target segment type
//!   cannot be transformed.
//! - [`MaterializationError::UnsupportedProposal`] — the proposal kind or
//!   strategy parameter is not realizable by this materializer.

use std::fmt;

use thalos_core::analysis::action::ActionKind;
use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::kinematics::inverse::{IKGoal, IKSolver};
use thalos_core::motion::segment::MotionSegment;

use crate::feedback::operator::ActionProposal;

/// Translates an [`ActionProposal`] into concrete plan modifications.
///
/// Implementations are [`Send`] + [`Sync`] so the orchestrator can hold them
/// behind `Box<dyn ProposalMaterializer>`.
///
/// # Contract
///
/// - `name()` returns a `&'static str` for logging/metrics.
/// - `materialize()` returns the replacement [`MotionSegment`]s for the given
///   target segment, or a [`MaterializationError`] when the proposal or target
///   cannot be realized. It NEVER decides phenomena — that is the operator's
///   job (C4).
pub trait ProposalMaterializer: Send + Sync {
    /// Human-readable materializer name for logging and metrics.
    fn name(&self) -> &'static str;

    /// Produces the concrete [`MotionSegment`]s that realize `proposal` on the
    /// target segment.
    ///
    /// # Errors
    ///
    /// See [`MaterializationError`] for the failure modes.
    fn materialize(
        &self,
        proposal: &ActionProposal,
        target: &MotionSegment,
    ) -> Result<Vec<MotionSegment>, MaterializationError>;
}

/// Errors that can occur while materializing a proposal into plan segments.
#[derive(Debug, Clone, PartialEq)]
pub enum MaterializationError {
    /// Inverse kinematics failed to converge on a joint solution.
    IkFailure,
    /// The target segment type cannot be transformed by this materializer.
    UnsupportedSegment,
    /// The proposal kind (or its parameters) is not realizable.
    UnsupportedProposal {
        /// The proposal kind that could not be materialized.
        kind: ActionKind,
    },
}

impl fmt::Display for MaterializationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MaterializationError::IkFailure => {
                write!(f, "IK did not converge while materializing the proposal")
            }
            MaterializationError::UnsupportedSegment => {
                write!(f, "unsupported target segment type for this proposal")
            }
            MaterializationError::UnsupportedProposal { kind } => {
                write!(f, "unsupported proposal kind: {kind:?}")
            }
        }
    }
}

impl std::error::Error for MaterializationError {}

/// Materializes `SwitchMoveStrategy` proposals that switch a `MoveL` to a
/// `MoveJ` — the generalized successor of the legacy `switch_strategy` operator.
///
/// The conversion uses an [`IKSolver`] to compute joint-space coordinates for
/// the `MoveL` target pose. If IK does not converge,
/// [`MaterializationError::IkFailure`] is returned.
pub struct SwitchMoveMaterializer<'a> {
    /// IK solver used to convert Cartesian poses to joint targets.
    ik_solver: &'a dyn IKSolver,
    /// Current joint positions — the starting configuration for IK.
    current_joints: &'a [f64],
}

impl<'a> SwitchMoveMaterializer<'a> {
    /// Creates a new `SwitchMoveMaterializer`.
    ///
    /// * `ik_solver` — solver used to compute IK for the `MoveL` target pose.
    /// * `current_joints` — the robot's current joint configuration (q0).
    pub fn new(ik_solver: &'a dyn IKSolver, current_joints: &'a [f64]) -> Self {
        Self {
            ik_solver,
            current_joints,
        }
    }
}

impl ProposalMaterializer for SwitchMoveMaterializer<'_> {
    fn name(&self) -> &'static str {
        "switch_move_materializer"
    }

    fn materialize(
        &self,
        proposal: &ActionProposal,
        target: &MotionSegment,
    ) -> Result<Vec<MotionSegment>, MaterializationError> {
        // C4: the proposal's kind and parameters decide HOW — never a
        // phenomenon lookup. The only realizable remediation here is a
        // strategy switch to MoveJ.
        if proposal.kind != ActionKind::SwitchMoveStrategy {
            return Err(MaterializationError::UnsupportedProposal {
                kind: proposal.kind,
            });
        }
        match proposal.parameters.get("strategy") {
            Some(AttributeValue::Text(s)) if s == "move_j" => {}
            _ => {
                return Err(MaterializationError::UnsupportedProposal {
                    kind: proposal.kind,
                })
            }
        }

        // Only a Cartesian segment can be re-expressed in joint space.
        let MotionSegment::MoveL {
            origin,
            target_pose,
            max_velocity,
            ..
        } = target
        else {
            return Err(MaterializationError::UnsupportedSegment);
        };

        let result = self
            .ik_solver
            .solve(self.current_joints, IKGoal::Pose(target_pose.clone()))
            .map_err(|_| MaterializationError::IkFailure)?;

        if !result.status.is_converged() {
            return Err(MaterializationError::IkFailure);
        }

        Ok(vec![MotionSegment::MoveJ {
            origin: origin.clone(),
            target: result.q,
            max_velocity: *max_velocity,
            max_acceleration: None,
        }])
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use thalos_core::analysis::action::{ActionImpact, ActionKind, ActionPriority};
    use thalos_core::analysis::attribute_value::AttributeValue;
    use thalos_core::analysis::observation::ObservationId;
    use thalos_core::ids::OperationId;
    use thalos_core::kinematics::inverse::{IKGoal, IKResult, IKSolver, IKStatus, IkError};
    use thalos_core::motion::segment::MotionSegment;
    use thalos_core::prelude::{FrameId, Pose, Transform3D};

    use crate::feedback::operator::ActionProposal;

    use super::{MaterializationError, ProposalMaterializer, SwitchMoveMaterializer};

    // ── Helpers ────────────────────────────────────────────────────────────

    /// The proposal shape the new-model operator (PR 4b) emits for a tracking
    /// phenomenon: kind `SwitchMoveStrategy` + `strategy`/`tracking_value`.
    fn switch_proposal(strategy: &str, tracking_value: f64) -> ActionProposal {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "strategy".to_string(),
            AttributeValue::Text(strategy.to_string()),
        );
        parameters.insert(
            "tracking_value".to_string(),
            AttributeValue::Number(tracking_value),
        );
        ActionProposal {
            kind: ActionKind::SwitchMoveStrategy,
            target_observation: ObservationId(1),
            priority: ActionPriority::Medium,
            impact: ActionImpact::Medium,
            parameters,
        }
    }

    fn move_l(origin: &str, max_velocity: Option<f64>) -> MotionSegment {
        MotionSegment::MoveL {
            origin: OperationId(origin.into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity,
        }
    }

    /// Mock solver that always converges, returning q0 as the solution.
    struct NoopIKSolver;

    impl IKSolver for NoopIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult::converged(q0.to_vec(), 1, 0.0, None))
        }
    }

    /// Mock solver that never converges (`MaxIterations`).
    struct FailingIKSolver;

    impl IKSolver for FailingIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult::max_iterations(q0.to_vec(), 100, 1.5, None))
        }
    }

    // ── GREEN — name + happy path ──────────────────────────────────────────

    #[test]
    fn materializer_name_is_identifiable() {
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let materializer = SwitchMoveMaterializer::new(&solver, &q0);

        assert_eq!(materializer.name(), "switch_move_materializer");
    }

    #[test]
    fn materialize_switch_strategy_converts_move_l_to_move_j() {
        // C1: proposal → concrete plan modification. The MoveL target pose is
        // solved through IK and the replacement is a MoveJ preserving origin
        // and velocity limits, with acceleration left for the planner (the
        // exact contract the legacy operator enforced).
        let q0 = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let solver = NoopIKSolver;
        let materializer = SwitchMoveMaterializer::new(&solver, &q0);

        let proposal = switch_proposal("move_j", 0.8);
        let segments = materializer
            .materialize(&proposal, &move_l("move_1", Some(100.0)))
            .expect("move_j switch must materialize");

        assert_eq!(segments.len(), 1);
        match &segments[0] {
            MotionSegment::MoveJ {
                target,
                max_velocity,
                max_acceleration,
                ..
            } => {
                assert_eq!(target, &q0, "target must match the IK solution");
                assert_eq!(*max_velocity, Some(100.0), "must preserve max_velocity");
                assert_eq!(
                    *max_acceleration, None,
                    "MoveJ must leave acceleration to the planner"
                );
            }
            other => panic!("expected MoveJ, got {other:?}"),
        }
    }

    // ── TRIANGULATE — proposal/segment dispatch ────────────────────────────

    #[test]
    fn materialize_preserves_origin_and_velocity() {
        // Triangulation: a different origin and velocity profile survive the
        // conversion — the materializer copies plan data, never invents it.
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let materializer = SwitchMoveMaterializer::new(&solver, &q0);

        let segments = materializer
            .materialize(&switch_proposal("move_j", 0.9), &move_l("move_7", Some(50.0)))
            .expect("materialize");
        match &segments[0] {
            MotionSegment::MoveJ { origin, max_velocity, .. } => {
                assert_eq!(origin, &OperationId("move_7".into()));
                assert_eq!(*max_velocity, Some(50.0));
            }
            other => panic!("expected MoveJ, got {other:?}"),
        }
    }

    #[test]
    fn materialize_rejects_unsupported_proposal_kind() {
        // C4: the materializer translates proposals — a proposal whose kind it
        // cannot realize is rejected, never silently ignored.
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let materializer = SwitchMoveMaterializer::new(&solver, &q0);

        let mut proposal = switch_proposal("move_j", 0.8);
        proposal.kind = ActionKind::Velocity;

        match materializer.materialize(&proposal, &move_l("m", None)) {
            Err(MaterializationError::UnsupportedProposal { kind }) => {
                assert_eq!(kind, ActionKind::Velocity);
            }
            other => panic!("expected UnsupportedProposal, got {other:?}"),
        }
    }

    #[test]
    fn materialize_rejects_unsupported_strategy_parameter() {
        // The proposal declares the strategy to switch to; a strategy this
        // materializer cannot realize is rejected (parameters drive HOW).
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let materializer = SwitchMoveMaterializer::new(&solver, &q0);

        match materializer.materialize(&switch_proposal("osc", 0.8), &move_l("m", None)) {
            Err(MaterializationError::UnsupportedProposal { kind }) => {
                assert_eq!(kind, ActionKind::SwitchMoveStrategy);
            }
            other => panic!("expected UnsupportedProposal, got {other:?}"),
        }
    }

    #[test]
    fn materialize_rejects_non_move_l_target_segment() {
        // A MoveJ target is not a Cartesian segment — switching strategy is
        // meaningless, rejected defensively (mirrors the legacy contract).
        let q0 = vec![0.0; 6];
        let solver = NoopIKSolver;
        let materializer = SwitchMoveMaterializer::new(&solver, &q0);

        let target = MotionSegment::MoveJ {
            origin: OperationId("m".into()),
            target: vec![0.0; 6],
            max_velocity: None,
            max_acceleration: None,
        };

        match materializer.materialize(&switch_proposal("move_j", 0.8), &target) {
            Err(MaterializationError::UnsupportedSegment) => {}
            other => panic!("expected UnsupportedSegment, got {other:?}"),
        }
    }

    // ── TRIANGULATE — IK failure ───────────────────────────────────────────

    #[test]
    fn materialize_returns_ik_failure_on_non_convergence() {
        let q0 = vec![0.0; 6];
        let solver = FailingIKSolver;
        let materializer = SwitchMoveMaterializer::new(&solver, &q0);

        match materializer.materialize(&switch_proposal("move_j", 0.8), &move_l("m", None)) {
            Err(MaterializationError::IkFailure) => {}
            other => panic!("expected IkFailure, got {other:?}"),
        }
    }

    // ── TRIANGULATE — error Display ────────────────────────────────────────

    #[test]
    fn materialization_error_displays_human_readable_message() {
        let err = MaterializationError::UnsupportedProposal {
            kind: ActionKind::Collision,
        };
        let msg = err.to_string();
        assert!(
            msg.contains("unsupported proposal"),
            "msg: {msg}"
        );
        assert!(msg.contains("Collision"), "msg: {msg}");
    }
}
