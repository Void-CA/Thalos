//! Renderer contract (design D4) — external projection of an
//! [`AnalysisReport`](crate::analysis::report::AnalysisReport).
//!
//! # Presentation-free domain (spec I6)
//!
//! The domain knows only the [`Renderer`] abstraction. The trait binds NO
//! presentation format: no HTML, Markdown, terminal, REST or JSON type appears
//! in the model. Concrete renderers (CLI, web UI, JSON API) are external
//! projections implemented in later phases (cambio A) — a renderer is a pure
//! function of the report.
//!
//! # Full report (user contract C5)
//!
//! [`Renderer::render`] receives the COMPLETE report — observations, actions,
//! metrics and summary — so a renderer can build a full representation without
//! recomposing context from observations alone.

use crate::analysis::report::AnalysisReport;

/// Contract for rendering an [`AnalysisReport`] into an arbitrary output
/// representation (design D4, spec I6).
///
/// `Output` is the renderer's projection type (a string, a DTO, a struct).
/// The same report may be projected by any number of renderers with unrelated
/// `Output` types; the trait imposes no format.
pub trait Renderer {
    /// The produced representation.
    type Output;

    /// Renders the complete report (observations, actions, metrics, summary).
    fn render(&self, report: &AnalysisReport) -> Self::Output;
}

#[cfg(test)]
mod tests {
    use super::Renderer;
    use crate::analysis::action::{Action, ActionId, ActionImpact, ActionKind, ActionPriority};
    use crate::analysis::aggregator::{Aggregator, DefaultAggregator};
    use crate::analysis::location::Location;
    use crate::analysis::observation::{
        ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
    };
    use crate::analysis::report::AnalysisReport;
    use crate::analysis::scoring::DefaultScoringPolicy;
    use crate::ids::MotionPlanId;
    use std::collections::BTreeMap;

    fn sample_report() -> AnalysisReport {
        let observations = vec![
            Observation {
                id: ObservationId(0),
                kind: ObservationKind::NearSingularity,
                severity: Severity::Warning,
                artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
                location: Location::Waypoint(3),
                attributes: BTreeMap::new(),
                causes: Vec::new(),
                related: Vec::new(),
            },
            Observation {
                id: ObservationId(0),
                kind: ObservationKind::TrackingError,
                severity: Severity::Error,
                artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
                location: Location::Waypoint(4),
                attributes: BTreeMap::new(),
                causes: Vec::new(),
                related: Vec::new(),
            },
        ];
        let mut report = DefaultAggregator::new(DefaultScoringPolicy).aggregate(
            ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
            observations,
        );
        // Give the renderer actions + metrics so the projection test can prove
        // full-report access (C5), not just observations.
        report.actions.push(Action {
            id: ActionId(1),
            kind: ActionKind::Waypoint,
            target_observation: report.observations[0].id,
            priority: ActionPriority::High,
            impact: ActionImpact::Medium,
            parameters: BTreeMap::new(),
        });
        report.metrics.insert("execution_ms".to_string(), 12.5);
        report
    }

    /// A renderer whose Output is a plain custom struct — NOT HTML, Markdown,
    /// terminal or REST (I6: the trait binds no presentation format).
    struct TextProjection {
        observations: usize,
        actions: usize,
        metrics: usize,
        quality_index: f64,
    }

    /// Fake renderer: projects the full report onto a domain-neutral struct.
    struct SummaryRenderer;

    impl Renderer for SummaryRenderer {
        type Output = TextProjection;

        fn render(&self, report: &AnalysisReport) -> TextProjection {
            TextProjection {
                observations: report.observations.len(),
                actions: report.actions.len(),
                metrics: report.metrics.len(),
                quality_index: report.summary.quality_index,
            }
        }
    }

    /// A second renderer with a DIFFERENT Output type for the same report
    /// (I6 "Multiple renderers same report").
    struct CountRenderer;

    impl Renderer for CountRenderer {
        type Output = usize;

        fn render(&self, report: &AnalysisReport) -> usize {
            report.observations.len()
        }
    }

    #[test]
    fn renderer_projects_full_report_without_presentation_format() {
        // C5 + I6: the renderer receives the COMPLETE report (observations,
        // actions, metrics, summary) and produces a custom Output — no
        // HTML/Markdown/terminal/REST type appears anywhere in this module.
        let report = sample_report();
        let projection = SummaryRenderer.render(&report);
        assert_eq!(projection.observations, 2);
        assert_eq!(projection.actions, 1);
        assert_eq!(projection.metrics, 1);
        // quality_index derived from the summary: 1 - 0.15 (Warning) - 0.30 (Error).
        assert!((projection.quality_index - 0.55).abs() < 1e-12);
    }

    #[test]
    fn different_renderers_different_outputs_same_report() {
        // I6: the same report projects through renderers with unrelated Output
        // types (struct vs usize) — the trait owns no format.
        let report = sample_report();
        let projection = SummaryRenderer.render(&report);
        let count = CountRenderer.render(&report);
        assert_eq!(projection.observations, 2);
        assert_eq!(count, 2);
    }
}
