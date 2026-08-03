//! Temporal compatibility adapter: [`ExecutionFinding`] → [`Observation`].
//!
//! ## Purpose (PR 4c, user Option A)
//!
//! The feedback loop's legacy analyzer ([`analyze_trace`]) produces
//! [`ExecutionFinding`]s, while the new-model operators (PR 4b) consume the
//! unified [`Observation`] vocabulary. This adapter is the **unique
//! compatibility bridge** between the two (user contract C2): legacy
//! `ExecutionFinding`s can be fed to new-model
//! [`ObservationIntentionOperator`]s without touching the legacy orchestrator
//! — which keeps operating on `ExecutionFinding` until PR 4d.
//!
//! It mirrors the plan-level [`FindingAdapter`](crate::analysis::adapter::FindingAdapter)
//! contract: the caller supplies the [`ArtifactRef`] (I3), the adapter maps
//! kind/location/attributes, and the produced observation gets a placeholder
//! id — the aggregator reassigns unique ids during report construction
//! (closed decision).
//!
//! ## Mapping (mechanical — user contract C1)
//!
//! | `ExecutionFinding` | → Observation | Notes |
//! |---|---|---|
//! | `kind: HighTrackingError` | `kind: ObservationKind::TrackingError` | The runtime tracking phenomena inherit the legacy `HighTrackingError` intent (C2, see `observation_switch_strategy` module docs) |
//! | *(no severity field)* | `severity: Severity::Error` | Fixed documented grade: the legacy kind names the *error* phenomenon; the new-model operator tests build tracking observations with the same grade |
//! | `segment_id` | `location: Location::Waypoint(segment_id)` | Positional anchor: the finding names its segment by index in the `PlanningProgram` (`program.segments[finding.segment_id]`) |
//! | `value` | `attributes["value"] = Number(value)` | Observed metric carried as-is — legacy units preserved, **no conversion** (C1) |
//! | *(fixed legacy threshold)* | `attributes["threshold"] = Number(DEFAULT_TRACKING_ERROR_THRESHOLD)` | Public analyzer constant, so new-model operators can parametrize proposal severity from the value/threshold margin |
//! | `segment_id` | `attributes["segment_id"] = Integer(segment_id)` | Lossless positional info (D5) |
//! | *(no message field)* | *(dropped — I1)* | The legacy finding carries no presentation text; the bridge invents none |
//!
//! ## Removal gate
//!
//! Temporary by design: deleted in PR 6 together with the legacy
//! `ExecutionFinding` path ([`analyze_trace`], [`ExecutionFinding`] itself).
//! Since PR 4d the main feedback loop no longer consumes it — `run()`
//! analyzes directly through an
//! [`Analyzer`](thalos_core::analysis::analyzer::Analyzer), and the legacy
//! `IntentionOperator` signature is gone (user contract C3: adapter off the
//! main path, kept only until the legacy model is deleted).
//!
//! [`analyze_trace`]: crate::feedback::finding::analyze_trace
//! [`ObservationIntentionOperator`]: crate::feedback::operator::ObservationIntentionOperator

use std::collections::BTreeMap;

use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::analysis::location::Location;
use thalos_core::analysis::observation::{
    ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
};

use crate::feedback::finding::{DEFAULT_TRACKING_ERROR_THRESHOLD, ExecutionFinding, FindingKind};

/// Bridges legacy execution findings onto the unified observation model.
///
/// Stateless by design — same shape as the plan-level
/// [`FindingAdapter`](crate::analysis::adapter::FindingAdapter): a unit
/// struct with `convert`/`convert_all` entry points.
pub struct ExecutionFindingAdapter;

impl ExecutionFindingAdapter {
    /// Converts a single legacy finding into an [`Observation`] anchored to
    /// the given artifact (I3).
    pub fn convert(&self, artifact: ArtifactRef, finding: &ExecutionFinding) -> Observation {
        Observation {
            id: ObservationId(0), // aggregator reassigns 1..=n (closed decision)
            kind: Self::map_kind(finding.kind),
            severity: Severity::Error,
            artifact,
            location: Location::Waypoint(finding.segment_id),
            attributes: Self::map_attributes(finding),
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    /// Converts the legacy [`analyze_trace`](crate::feedback::finding::analyze_trace)
    /// output shape: a slice of findings → one observation each.
    pub fn convert_all(
        &self,
        artifact: ArtifactRef,
        findings: &[ExecutionFinding],
    ) -> Vec<Observation> {
        findings
            .iter()
            .map(|finding| self.convert(artifact.clone(), finding))
            .collect()
    }

    /// Maps the legacy execution-finding kind onto the model's vocabulary.
    fn map_kind(kind: FindingKind) -> ObservationKind {
        match kind {
            // The only legacy execution phenomenon; inherits the runtime
            // TrackingError intent (C2).
            FindingKind::HighTrackingError => ObservationKind::TrackingError,
        }
    }

    /// Typed attributes (D5) carrying exactly what the finding transports:
    /// the observed value, the fixed legacy threshold, and the positional
    /// anchor. Never invents data the finding does not carry (C1).
    fn map_attributes(finding: &ExecutionFinding) -> BTreeMap<String, AttributeValue> {
        let mut attributes = BTreeMap::new();
        attributes.insert("value".to_string(), AttributeValue::Number(finding.value));
        attributes.insert(
            "threshold".to_string(),
            AttributeValue::Number(DEFAULT_TRACKING_ERROR_THRESHOLD),
        );
        attributes.insert(
            "segment_id".to_string(),
            AttributeValue::Integer(finding.segment_id as i64),
        );
        attributes
    }
}

#[cfg(test)]
mod tests {
    use super::ExecutionFindingAdapter;
    use thalos_core::analysis::attribute_value::AttributeValue;
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{ArtifactRef, ObservationKind, Severity};
    use thalos_core::ids::ExecutionSessionId;

    use crate::feedback::finding::{
        DEFAULT_TRACKING_ERROR_THRESHOLD, ExecutionFinding, FindingKind,
    };

    fn artifact() -> ArtifactRef {
        ArtifactRef::ExecutionSession(ExecutionSessionId("es-1".to_string()))
    }

    fn finding(segment_id: usize, value: f64) -> ExecutionFinding {
        ExecutionFinding {
            segment_id,
            kind: FindingKind::HighTrackingError,
            value,
        }
    }

    fn adapter() -> ExecutionFindingAdapter {
        ExecutionFindingAdapter
    }

    #[test]
    fn execution_finding_kind_maps_to_observation_kind() {
        // The legacy execution loop only ever produces HighTrackingError;
        // it inherits the runtime TrackingError phenomenon (C2, same intent
        // as documented in observation_switch_strategy).
        let observation = adapter().convert(artifact(), &finding(2, 0.8));
        assert_eq!(observation.kind, ObservationKind::TrackingError);
    }

    #[test]
    fn severity_is_fixed_error_when_finding_carries_none() {
        // ExecutionFinding has NO severity field — the bridge assigns the
        // Error grade: the legacy kind name is the "error" phenomenon, and
        // the new-model operator tests build tracking observations with the
        // same grade. Documented mapping, not business logic (C1).
        let observation = adapter().convert(artifact(), &finding(2, 0.8));
        assert_eq!(observation.severity, Severity::Error);
    }

    #[test]
    fn segment_id_maps_to_location_waypoint() {
        // The finding names its segment by index in the PlanningProgram; the
        // orchestrator resolves it via `program.segments[finding.segment_id]`.
        // The bridge anchors that positional info as Location::Waypoint.
        assert_eq!(
            adapter().convert(artifact(), &finding(2, 0.8)).location,
            Location::Waypoint(2)
        );
        // Triangulation: a different segment anchors a different waypoint.
        assert_eq!(
            adapter().convert(artifact(), &finding(5, 0.8)).location,
            Location::Waypoint(5)
        );
    }

    #[test]
    fn value_threshold_and_segment_map_to_typed_attributes() {
        // value carries the observed metric as-is (legacy units preserved, no
        // conversion — C1); threshold is the fixed legacy analyzer constant,
        // so new-model operators can parametrize severity from the margin;
        // segment_id preserves the positional anchor losslessly (D5).
        let observation = adapter().convert(artifact(), &finding(2, 0.8));
        assert_eq!(observation.attributes["value"], AttributeValue::Number(0.8));
        assert_eq!(
            observation.attributes["threshold"],
            AttributeValue::Number(DEFAULT_TRACKING_ERROR_THRESHOLD)
        );
        assert_eq!(
            observation.attributes["segment_id"],
            AttributeValue::Integer(2)
        );

        // Triangulation: a different value maps to a different Number.
        let other = adapter().convert(artifact(), &finding(2, 0.9));
        assert_eq!(other.attributes["value"], AttributeValue::Number(0.9));
    }

    #[test]
    fn no_presentation_field_survives_into_the_observation() {
        // I1: the observation carries facts, never presentation. The legacy
        // finding has no message field, and the bridge must not invent one.
        let observation = adapter().convert(artifact(), &finding(2, 0.8));
        let json = serde_json::to_value(&observation).expect("serialize");
        let obj = json.as_object().expect("object");
        for banned in ["message", "text", "icon", "label", "description"] {
            assert!(
                !obj.contains_key(banned),
                "observation must not carry presentation field `{banned}`"
            );
        }
    }

    #[test]
    fn artifact_anchors_the_observation() {
        // I3: every observation belongs to exactly one artifact; ExecutionFinding
        // has no artifact field, so the caller supplies it (same contract as
        // the plan-level FindingAdapter).
        let observation = adapter().convert(artifact(), &finding(2, 0.8));
        assert_eq!(observation.artifact, artifact());
    }

    #[test]
    fn convert_all_maps_each_finding() {
        // The legacy `analyze_trace` output shape: Vec<ExecutionFinding> →
        // Vec<Observation>, one per finding, placeholder ids for the
        // aggregator (closed decision).
        let findings = vec![finding(0, 0.6), finding(3, 0.9)];
        let observations = adapter().convert_all(artifact(), &findings);
        assert_eq!(observations.len(), 2);
        assert_eq!(observations[0].location, Location::Waypoint(0));
        assert_eq!(observations[1].location, Location::Waypoint(3));
        assert!(observations.iter().all(|o| o.artifact == artifact()));
    }
}
