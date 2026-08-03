//! TEMPORARY bridge from the legacy `Finding` vocabulary to the canonical
//! `Observation` model.
//!
//! # TODO(analysis-model): remove after phase 6
//!
//! This adapter is a **temporal coexistence bridge**, NOT part of the analysis
//! model (user contract C3). It exists so un-migrated analyzers keep producing
//! results while they migrate one by one onto
//! `Vec<Observation>` (coexistence strategy, tasks.md). When phase 6 deletes
//! the legacy `Finding` vocabulary, this file is deleted with it.
//!
//! # Mapping (spec I1-I3)
//!
//! - `kind` → [`ObservationKind`]: exact for vocabulary overlaps; documented
//!   lossy bridges for plan-specific kinds (the 10-variant model vocabulary is
//!   completed in PR 3 when `TrajectoryAnalyzer` migrates).
//! - `severity` → [`Severity`]: 1:1 (`Info`/`Warning`/`Error`).
//! - `waypoint` → [`Location::Waypoint`]; findings without a waypoint fall
//!   back to [`Location::Timestamp(0)`] (proposal risk table).
//! - `value`/`threshold` → `attributes["value"|"threshold"]` as
//!   [`AttributeValue::Number`] (D5), only when present.
//! - `message` → **DROPPED** (I1): observations carry facts, never localized
//!   text. Renderers reconstruct presentation in cambio A.
//!
//! `Finding` has no artifact field (I3), so the caller supplies the
//! [`ArtifactRef`] every observation is anchored to.

use std::collections::BTreeMap;

use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::analysis::location::Location;
use thalos_core::analysis::observation::{
    ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
};

use crate::finding::{Finding, FindingKind, Severity as FindingSeverity};

/// Temporal `Finding → Observation` bridge (see module docs).
///
/// Unit struct: the conversion is a pure function of `(artifact, finding)`.
/// Not part of the domain model — deleted in phase 6.
#[derive(Debug, Clone, Copy, Default)]
pub struct FindingAdapter;

impl FindingAdapter {
    /// Converts one legacy finding into a canonical observation.
    ///
    /// `artifact` anchors the observation (I3). The produced observation gets a
    /// placeholder id — the aggregator reassigns unique ids during report
    /// construction (closed decision).
    pub fn convert(&self, artifact: ArtifactRef, finding: &Finding) -> Observation {
        Observation {
            id: ObservationId(0), // aggregator reassigns 1..=n
            kind: Self::map_kind(finding.kind),
            severity: Self::map_severity(finding.severity),
            artifact,
            location: finding
                .waypoint
                .map(Location::Waypoint)
                .unwrap_or(Location::Timestamp(0)),
            attributes: Self::map_attributes(finding),
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    /// Converts a slice of findings (the legacy analyzer output shape).
    pub fn convert_all(&self, artifact: ArtifactRef, findings: &[Finding]) -> Vec<Observation> {
        findings
            .iter()
            .map(|finding| self.convert(artifact.clone(), finding))
            .collect()
    }

    /// Maps a plan-specific [`FindingKind`] onto the model's [`ObservationKind`].
    ///
    /// Vocabulary overlaps map 1:1; plan-only kinds use documented lossy
    /// bridges. This table is temporary (PR 3 completes the vocabulary).
    fn map_kind(kind: FindingKind) -> ObservationKind {
        match kind {
            FindingKind::NearSingularity => ObservationKind::NearSingularity,
            FindingKind::TrackingError => ObservationKind::TrackingError,
            // No full-singularity variant in the model: a singularity is the
            // degenerate case of the near-singularity phenomenon.
            FindingKind::Singularity => ObservationKind::NearSingularity,
            // The model has a single collision phenomenon; near-collision is
            // the same risk at a smaller distance.
            FindingKind::Collision | FindingKind::CollisionNear => ObservationKind::CollisionRisk,
            // Closest phenomenon: a constraint violation typically surfaces as
            // a joint-level limit violation.
            FindingKind::ConstraintViolation => ObservationKind::JointLimitViolation,
            // A tracking spike is a transient peak of the tracking error.
            FindingKind::TrackingSpike => ObservationKind::TrackingError,
            // Executed joint/velocity deviations are runtime deviations.
            FindingKind::JointDeviation | FindingKind::VelocityDeviation => {
                ObservationKind::RuntimeDeviation
            }
            // No manipulability/IK-suggestion phenomenon yet: bridge to the
            // nearest residual-quality phenomenon. PR 3 adds the vocabulary.
            FindingKind::LowManipulability | FindingKind::IkSuggestion => {
                ObservationKind::ResidualError
            }
        }
    }

    /// 1:1 severity mapping (`Info`/`Warning`/`Error` are shared vocabulary).
    fn map_severity(severity: FindingSeverity) -> Severity {
        match severity {
            FindingSeverity::Info => Severity::Info,
            FindingSeverity::Warning => Severity::Warning,
            FindingSeverity::Error => Severity::Error,
        }
    }

    /// Typed attributes for `value`/`threshold` (D5), present only when the
    /// finding carries them. `message` is deliberately NOT mapped (I1).
    fn map_attributes(finding: &Finding) -> BTreeMap<String, AttributeValue> {
        let mut attributes = BTreeMap::new();
        if let Some(value) = finding.value {
            attributes.insert("value".to_string(), AttributeValue::Number(value));
        }
        if let Some(threshold) = finding.threshold {
            attributes.insert("threshold".to_string(), AttributeValue::Number(threshold));
        }
        attributes
    }
}

#[cfg(test)]
mod tests {
    use super::FindingAdapter;
    use crate::finding::{Finding, FindingKind, Severity as FindingSeverity};
    use serde_json::json;
    use std::collections::BTreeMap;
    use thalos_core::analysis::attribute_value::AttributeValue;
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{ArtifactRef, ObservationKind, Severity};
    use thalos_core::ids::MotionPlanId;

    fn artifact() -> ArtifactRef {
        ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string()))
    }

    fn finding(kind: FindingKind) -> Finding {
        Finding {
            kind,
            severity: FindingSeverity::Warning,
            waypoint: Some(5),
            message: "Manipulabilidad baja cerca del waypoint 5".to_string(),
            value: Some(0.12),
            threshold: Some(0.15),
        }
    }

    fn adapter() -> FindingAdapter {
        FindingAdapter
    }

    #[test]
    fn finding_kind_maps_to_observation_kind() {
        // kind → ObservationKind (spec I2: phenomenon, machine-readable).
        // The exact-vocabulary arms map 1:1; the rest are documented lossy
        // bridges until PR 3 completes the ObservationKind vocabulary.
        let cases = [
            (
                FindingKind::NearSingularity,
                ObservationKind::NearSingularity,
            ),
            (FindingKind::TrackingError, ObservationKind::TrackingError),
            (FindingKind::Singularity, ObservationKind::NearSingularity),
            (FindingKind::Collision, ObservationKind::CollisionRisk),
            (FindingKind::CollisionNear, ObservationKind::CollisionRisk),
            (
                FindingKind::ConstraintViolation,
                ObservationKind::JointLimitViolation,
            ),
            (FindingKind::TrackingSpike, ObservationKind::TrackingError),
            (
                FindingKind::JointDeviation,
                ObservationKind::RuntimeDeviation,
            ),
            (
                FindingKind::VelocityDeviation,
                ObservationKind::RuntimeDeviation,
            ),
            (
                FindingKind::LowManipulability,
                ObservationKind::ResidualError,
            ),
            (FindingKind::IkSuggestion, ObservationKind::ResidualError),
        ];
        for (kind, expected) in cases {
            let observation = adapter().convert(artifact(), &finding(kind));
            assert_eq!(
                observation.kind, expected,
                "FindingKind {kind:?} must map to {expected:?}"
            );
        }
    }

    #[test]
    fn severity_maps_one_to_one() {
        // severity → Severity (Info/Warning/Error, 1:1 with the model).
        let cases = [
            (FindingSeverity::Info, Severity::Info),
            (FindingSeverity::Warning, Severity::Warning),
            (FindingSeverity::Error, Severity::Error),
        ];
        for (legacy, expected) in cases {
            let mut finding = finding(FindingKind::NearSingularity);
            finding.severity = legacy;
            assert_eq!(adapter().convert(artifact(), &finding).severity, expected);
        }
    }

    #[test]
    fn waypoint_maps_to_location_waypoint() {
        // waypoint → Location::Waypoint (spec I2 location anchor).
        let observation = adapter().convert(artifact(), &finding(FindingKind::NearSingularity));
        assert_eq!(observation.location, Location::Waypoint(5));
    }

    #[test]
    fn missing_waypoint_falls_back_to_timestamp() {
        // Proposal risk table: findings without a waypoint fall back to
        // Location::Timestamp. Temporary bridge — PR 3 anchors properly.
        let mut finding = finding(FindingKind::NearSingularity);
        finding.waypoint = None;
        let observation = adapter().convert(artifact(), &finding);
        assert_eq!(observation.location, Location::Timestamp(0));
    }

    #[test]
    fn value_and_threshold_map_to_number_attributes() {
        // value/threshold → attributes["value"|"threshold"] as Number (D5).
        let observation = adapter().convert(artifact(), &finding(FindingKind::NearSingularity));
        assert_eq!(
            observation.attributes["value"],
            AttributeValue::Number(0.12)
        );
        assert_eq!(
            observation.attributes["threshold"],
            AttributeValue::Number(0.15)
        );
    }

    #[test]
    fn absent_value_and_threshold_omit_attributes() {
        // Triangulation: None value/threshold → no attribute keys at all.
        let mut finding = finding(FindingKind::NearSingularity);
        finding.value = None;
        finding.threshold = None;
        let observation = adapter().convert(artifact(), &finding);
        assert!(!observation.attributes.contains_key("value"));
        assert!(!observation.attributes.contains_key("threshold"));
    }

    #[test]
    fn message_is_dropped_never_carried_into_observation() {
        // I1: findings' localized message is NOT part of the observation —
        // observations carry facts, renderers own presentation (cambio A).
        let message = "Manipulabilidad baja cerca del waypoint 5";
        let mut finding = finding(FindingKind::NearSingularity);
        finding.message = message.to_string();
        let observation = adapter().convert(artifact(), &finding);
        let json = serde_json::to_value(&observation).expect("serialize");
        let obj = json.as_object().expect("object");
        for banned in ["message", "text", "icon", "label"] {
            assert!(
                !obj.contains_key(banned),
                "observation must not carry presentation field `{banned}`"
            );
        }
        // The localized text must not survive ANYWHERE — not as a field, not as
        // an attribute value, not as part of the serialized form.
        let serialized = json.to_string();
        assert!(
            !serialized.contains(message),
            "localized message must be dropped entirely, got: {serialized}"
        );
    }

    #[test]
    fn artifact_anchors_the_observation() {
        // I3: every observation belongs to exactly one artifact; Finding has no
        // artifact field, so the adapter receives it as a parameter.
        let observation = adapter().convert(artifact(), &finding(FindingKind::NearSingularity));
        assert_eq!(observation.artifact, artifact());
    }

    #[test]
    fn convert_all_maps_each_finding() {
        // Vec<Observation> bridge: one observation per finding, in order.
        let findings = vec![
            finding(FindingKind::NearSingularity),
            finding(FindingKind::TrackingError),
        ];
        let observations = adapter().convert_all(artifact(), &findings);
        assert_eq!(observations.len(), 2);
        assert_eq!(observations[0].kind, ObservationKind::NearSingularity);
        assert_eq!(observations[1].kind, ObservationKind::TrackingError);
    }
}
