//! New-model `SwitchMoveStrategy` over [`Observation`] (PR 4b).
//!
//! The legacy segment-transforming operator operated on the old
//! execution-finding vocabulary until PR 4d removed that trait; its
//! materialization logic now lives in the
//! [`ProposalMaterializer`](crate::feedback::materializer::ProposalMaterializer)
//! (proposal → segments). This operator consumes the unified observation
//! vocabulary instead (C1).
//!
//! ## Contract
//!
//! - **Declarative rules by phenomenon (C2)**: applicability is decided by
//!   `ObservationKind` — the runtime tracking phenomena (`TrackingError`,
//!   `TrackingSpike`) inherit the legacy `HighTrackingError` intent.
//!   `attributes` only parametrize the decision (severity of the proposal),
//!   never identify the phenomenon.
//! - **Proposal, not command (C3)**: `apply()` returns an
//!   [`ActionProposal`] — an intention to switch strategy. It never mutates
//!   the observation (C4) and never modifies the plan.
//! - **No hardcoded ids**: proposals carry no `ActionId`; the aggregator
//!   assigns ids when materializing (PR 4a gotcha).
//!
//! [Observation]: thalos_core::analysis::observation::Observation

use std::collections::BTreeMap;

use thalos_core::analysis::action::{ActionImpact, ActionKind, ActionPriority};
use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::analysis::observation::{Observation, ObservationKind};

use crate::feedback::operator::{ActionProposal, ObservationIntentionOperator};

/// Default tracking-error threshold mirroring the legacy trace-analyzer
/// constant, used when an observation carries no `threshold` attribute.
const DEFAULT_TRACKING_THRESHOLD: f64 = 0.5;

/// Float tolerance for severity boundaries (PR 4a gotcha): products like
/// `1.5 * 0.4` land on `0.6000000000000001`, so exact comparisons at the
/// boundary would silently demote a Medium margin to Low.
const SEVERITY_EPSILON: f64 = 1e-9;

/// Proposes switching the move strategy when a runtime tracking phenomenon is
/// observed — the new-model successor of the legacy MoveL→MoveJ operator.
///
/// Stateless by design: the operator only reads the observation (C4) and
/// returns an [`ActionProposal`] — the actual strategy switch is the
/// executor's responsibility (C3).
#[derive(Debug, Clone, Copy, Default)]
pub struct SwitchMoveStrategy;

impl SwitchMoveStrategy {
    /// Creates a new strategy operator.
    pub const fn new() -> Self {
        Self
    }
}

impl ObservationIntentionOperator for SwitchMoveStrategy {
    fn name(&self) -> &'static str {
        "switch_move_strategy"
    }

    fn applies_to(&self, observation: &Observation) -> bool {
        // C2: the phenomenon is identified by kind alone. The runtime tracking
        // phenomena map onto the legacy HighTrackingError intent.
        matches!(
            observation.kind,
            ObservationKind::TrackingError | ObservationKind::TrackingSpike
        )
    }

    fn apply(&self, observation: &Observation) -> Vec<ActionProposal> {
        // C2: attributes only parametrize the decision — the margin between
        // the observed value and the threshold scales the proposal's severity.
        let threshold = match observation.attributes.get("threshold") {
            Some(AttributeValue::Number(t)) => *t,
            _ => DEFAULT_TRACKING_THRESHOLD,
        };
        let value = match observation.attributes.get("value") {
            Some(AttributeValue::Number(v)) => *v,
            _ => threshold,
        };

        let (priority, impact) = if value + SEVERITY_EPSILON >= 2.0 * threshold {
            (ActionPriority::High, ActionImpact::High)
        } else if value + SEVERITY_EPSILON >= 1.5 * threshold {
            (ActionPriority::Medium, ActionImpact::Medium)
        } else {
            (ActionPriority::Low, ActionImpact::Low)
        };

        // C3: the proposal is an intention — the strategy to switch to is
        // declared as a parameter, not executed here.
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "strategy".to_string(),
            AttributeValue::Text("move_j".to_string()),
        );
        parameters.insert("tracking_value".to_string(), AttributeValue::Number(value));

        vec![ActionProposal {
            kind: ActionKind::SwitchMoveStrategy,
            target_observation: observation.id,
            priority,
            impact,
            parameters,
        }]
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use thalos_core::analysis::action::{ActionImpact, ActionKind, ActionPriority};
    use thalos_core::analysis::attribute_value::AttributeValue;
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{
        ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
    };
    use thalos_core::ids::ExecutionSessionId;

    use super::SwitchMoveStrategy;
    use crate::feedback::operator::{ActionProposal, ObservationIntentionOperator};

    /// Execution-domain observation carrying the ExecutionAnalyzer's tracking
    /// attribute schema (`value`/`threshold` as typed numbers).
    fn tracking_observation(
        id: u32,
        kind: ObservationKind,
        value: Option<f64>,
        threshold: Option<f64>,
    ) -> Observation {
        let mut attributes = BTreeMap::new();
        if let Some(value) = value {
            attributes.insert("value".to_string(), AttributeValue::Number(value));
        }
        if let Some(threshold) = threshold {
            attributes.insert("threshold".to_string(), AttributeValue::Number(threshold));
        }
        Observation {
            id: ObservationId(id),
            kind,
            severity: Severity::Error,
            artifact: ArtifactRef::ExecutionSession(ExecutionSessionId("e1".to_string())),
            location: Location::Timestamp(400),
            attributes,
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    #[test]
    fn applies_to_tracking_error_and_tracking_spike() {
        // C2: the phenomenon rule is kind-based — the runtime tracking
        // phenomena inherit the legacy HighTrackingError intent.
        let op = SwitchMoveStrategy::new();
        assert!(op.applies_to(&tracking_observation(
            1,
            ObservationKind::TrackingError,
            Some(0.8),
            Some(0.5)
        )));
        assert!(op.applies_to(&tracking_observation(
            2,
            ObservationKind::TrackingSpike,
            Some(0.15),
            Some(0.1)
        )));
    }

    #[test]
    fn does_not_apply_to_unrelated_phenomena() {
        // C2 triangulation: other kinds are not tracking phenomena, whatever
        // their attributes say.
        let op = SwitchMoveStrategy::new();
        for kind in [
            ObservationKind::NearSingularity,
            ObservationKind::PlaceWithoutPick,
            ObservationKind::VelocityDeviation,
        ] {
            assert!(
                !op.applies_to(&tracking_observation(1, kind, Some(0.8), Some(0.5))),
                "{kind:?} must not trigger a move-strategy switch"
            );
        }
    }

    #[test]
    fn apply_proposes_strategy_switch_targeting_observation() {
        // C3 + I5: the result is an ActionProposal (kind SwitchMoveStrategy)
        // referencing the observation by id — a proposal, not a command.
        let op = SwitchMoveStrategy::new();
        let obs = tracking_observation(7, ObservationKind::TrackingError, Some(0.8), Some(0.5));

        let proposals: Vec<ActionProposal> = op.apply(&obs);
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].kind, ActionKind::SwitchMoveStrategy);
        assert_eq!(proposals[0].target_observation, ObservationId(7));
        match proposals[0].parameters.get("strategy") {
            Some(AttributeValue::Text(s)) => assert_eq!(s, "move_j"),
            other => panic!("expected strategy parameter, got {other:?}"),
        }
    }

    #[test]
    fn apply_severity_is_parametrized_by_value_threshold_margin() {
        // C2: attributes only parametrize the decision — the margin between
        // the observed value and the threshold scales priority/impact.
        let op = SwitchMoveStrategy::new();

        // value == 2.0× threshold → High
        let high = op.apply(&tracking_observation(
            1,
            ObservationKind::TrackingError,
            Some(0.8),
            Some(0.4),
        ));
        assert_eq!(high[0].priority, ActionPriority::High);
        assert_eq!(high[0].impact, ActionImpact::High);

        // value == 1.5× threshold → Medium
        let medium = op.apply(&tracking_observation(
            2,
            ObservationKind::TrackingError,
            Some(0.6),
            Some(0.4),
        ));
        assert_eq!(medium[0].priority, ActionPriority::Medium);
        assert_eq!(medium[0].impact, ActionImpact::Medium);

        // value == 1.25× threshold → Low
        let low = op.apply(&tracking_observation(
            3,
            ObservationKind::TrackingError,
            Some(0.5),
            Some(0.4),
        ));
        assert_eq!(low[0].priority, ActionPriority::Low);
        assert_eq!(low[0].impact, ActionImpact::Low);
    }

    #[test]
    fn apply_leaves_observation_unchanged() {
        // C4: observations are immutable facts — applying never mutates them.
        let op = SwitchMoveStrategy::new();
        let obs = tracking_observation(5, ObservationKind::TrackingError, Some(0.8), Some(0.5));
        let snapshot = obs.clone();

        let _ = op.apply(&obs);
        assert_eq!(obs, snapshot);
    }

    #[test]
    fn apply_missing_attributes_uses_default_threshold() {
        // Triangulation: an observation without value/threshold still produces
        // a proposal — attributes only tune severity, never the phenomenon.
        let op = SwitchMoveStrategy::new();
        let obs = tracking_observation(6, ObservationKind::TrackingError, None, None);

        let proposals = op.apply(&obs);
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].target_observation, ObservationId(6));
    }
}
