//! Analyzer contract (design D2) — the producer side of the analysis model.
//!
//! An [`Analyzer`] turns an artifact input `&T` into a
//! [`Vec<Observation>`](crate::analysis::observation::Observation). It is the
//! trait every analyzer in Thalos (trajectory, execution, semantic) implements
//! so the aggregator can merge outputs across analyzers (spec I8).
//!
//! # Deliberately minimal (user contract C1)
//!
//! The trait is intentionally minimal: no context, configuration, logging,
//! cancellation, progress or async. Anything else can be layered later through
//! adapters or additional traits without breaking existing implementors — a
//! trait born loaded is hard to reuse.
//!
//! # Composability (spec I8, user contract C4)
//!
//! The trait is dyn-compatible (`Box<dyn Analyzer<T>>`): no associated types,
//! no generic methods, no `Self: Sized` bounds — so composite analyzers remain
//! possible without implementing one today.

use crate::analysis::observation::Observation;

/// Contract for artifact analyzers (design D2): an artifact input in,
/// machine-readable observations out.
///
/// `T` is the analyzer's input artifact type (a motion plan, an execution
/// trace, a semantic program). `analyze` must return the observed facts only —
/// aggregation into an [`AnalysisReport`](crate::analysis::report::AnalysisReport)
/// is the aggregator's job, never the analyzer's.
pub trait Analyzer<T> {
    /// Analyzes `input` and returns the observed facts (spec I1-I3).
    fn analyze(&self, input: &T) -> Vec<Observation>;
}

#[cfg(test)]
mod tests {
    use super::Analyzer;
    use crate::analysis::aggregator::{Aggregator, DefaultAggregator};
    use crate::analysis::location::Location;
    use crate::analysis::observation::{
        ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
    };
    use crate::analysis::scoring::DefaultScoringPolicy;
    use crate::ids::MotionPlanId;
    use std::collections::BTreeMap;

    /// Test-local artifact input: a stand-in for any artifact type an analyzer
    /// consumes. `Analyzer<T>` is generic (D2) — tests use a minimal fake.
    struct PlanInput;

    /// Fake analyzer 1: reports a near-singularity Warning.
    struct NearSingularityAnalyzer;

    impl Analyzer<PlanInput> for NearSingularityAnalyzer {
        fn analyze(&self, _input: &PlanInput) -> Vec<Observation> {
            vec![Observation {
                id: ObservationId(0), // aggregator reassigns
                kind: ObservationKind::NearSingularity,
                severity: Severity::Warning,
                artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
                location: Location::Waypoint(3),
                attributes: BTreeMap::new(),
                causes: Vec::new(),
                related: Vec::new(),
            }]
        }
    }

    /// Fake analyzer 2: reports a tracking Error for the same artifact.
    struct TrackingAnalyzer;

    impl Analyzer<PlanInput> for TrackingAnalyzer {
        fn analyze(&self, _input: &PlanInput) -> Vec<Observation> {
            vec![Observation {
                id: ObservationId(0),
                kind: ObservationKind::TrackingError,
                severity: Severity::Error,
                artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
                location: Location::Waypoint(3),
                attributes: BTreeMap::new(),
                causes: Vec::new(),
                related: Vec::new(),
            }]
        }
    }

    #[test]
    fn independent_analyzers_observations_coexist_with_own_severities() {
        // I8 (spec analysis-model "Coexisting observations" + "Independent
        // severity"): two analyzers targeting the same artifact produce
        // observations that coexist in the report — no overwrite, no merge —
        // and each observation keeps its own severity.
        let input = PlanInput;
        let mut all = NearSingularityAnalyzer.analyze(&input);
        all.extend(TrackingAnalyzer.analyze(&input));

        let report = DefaultAggregator::new(DefaultScoringPolicy).aggregate(
            ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
            all,
        );

        assert_eq!(report.observations.len(), 2);
        let kinds: Vec<ObservationKind> = report.observations.iter().map(|o| o.kind).collect();
        assert!(kinds.contains(&ObservationKind::NearSingularity));
        assert!(kinds.contains(&ObservationKind::TrackingError));
        // Independent severity (I8): the Warning stays Warning, the Error stays Error.
        let severities: Vec<Severity> = report.observations.iter().map(|o| o.severity).collect();
        assert!(severities.contains(&Severity::Warning));
        assert!(severities.contains(&Severity::Error));
        // Unique ids after merge (I8): the aggregator never collides.
        assert_ne!(report.observations[0].id, report.observations[1].id);
    }
}
