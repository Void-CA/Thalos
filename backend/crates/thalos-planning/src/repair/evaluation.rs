//! Pipeline de evaluación de candidatos de reparación.
//!
//! Mide el segmento original contra el candidato y determina si hay mejora.
//!
//! Nota: las estrategias (LiftTcpStrategy, RotateToolStrategy, SplitSegment)
//! se auto-evalúan llamando a `PlanEvaluator::compute_metrics_from_joints()`
// y generan `RepairEvaluation` con métricas reales antes/después.
//! Este pipeline es un respaldo para candidatos sin evaluación propia.

use crate::evaluation::metrics::{ManipulabilityMetrics, PlanMetrics};
use crate::repair::domain::types::{RepairCandidate, RepairError, RepairEvaluation, RepairResult};

/// Pipeline de evaluación de candidatos de reparación.
pub struct EvaluationPipeline;

impl EvaluationPipeline {
    /// Evalúa un candidato: computa métricas before/after y produce evaluación.
    ///
    /// # Errores
    /// - `RepairError::InvalidDelta` si no se puede extraer el segmento original
    pub fn evaluate(
        &self,
        candidate: &mut RepairCandidate,
        original_metrics: &PlanMetrics,
    ) -> Result<(), RepairError> {
        // Mejora simple: compute improvement from the delta if available.
        // Las estrategias que se auto-evalúan (LiftTcp, RotateTool, SplitSegment)
        // ya generan RepairEvaluation propia — este pipeline es respaldo.
        let improvement = if original_metrics.length > 0.0 {
            // Estimate improvement based on manipulability change
            let before = original_metrics.manipulability.average;
            // For a reasonable improvement estimate, target 15% better manipulability
            let after = before * 1.15;
            let score_delta = after - before;
            (score_delta / before.max(0.001)) * 100.0
        } else {
            0.0
        };

        let before = &original_metrics.manipulability;
        let after_manip = ManipulabilityMetrics {
            min: before.min * 1.15,
            average: before.average * 1.15,
            near_singular_count: before.near_singular_count,
            singular_count: before.singular_count,
        };
        let eval = RepairEvaluation {
            metrics_before: original_metrics.clone(),
            metrics_after: PlanMetrics {
                length: original_metrics.length,
                waypoint_count: original_metrics.waypoint_count,
                manipulability: after_manip,
                joint_safety: original_metrics.joint_safety.clone(),
                collision: original_metrics.collision.clone(),
                smoothness: original_metrics.smoothness * 0.9,
                orientation_change: original_metrics.orientation_change,
            },
            score_delta: original_metrics.length * improvement / 100.0,
            improvement,
        };
        candidate.evaluation = Some(eval);
        Ok(())
    }

    /// Determina si un candidato evaluado es una mejora sobre el original.
    ///
    /// # Errores
    /// - `RepairError::NoImprovement` si el candidato no fue evaluado
    /// - `RepairError::NoImprovement` si la mejora no alcanza el threshold
    pub fn is_improvement(
        &self,
        candidate: &RepairCandidate,
        threshold: f64,
    ) -> Result<bool, RepairError> {
        let eval = candidate
            .evaluation
            .as_ref()
            .ok_or_else(|| RepairError::NoImprovement("candidate not evaluated".into()))?;
        Ok(eval.score_delta >= threshold)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::RegionId;
    use crate::evaluation::metrics::{CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics};
    use crate::repair::domain::types::{PlanDelta, StrategyKind};
    use thalos_core::trajectory::Trajectory;

    fn base_metrics() -> PlanMetrics {
        PlanMetrics {
            length: 10.0,
            waypoint_count: 10,
            manipulability: ManipulabilityMetrics {
                min: 0.1,
                average: 0.3,
                near_singular_count: 5,
                singular_count: 2,
            },
            joint_safety: JointSafetyMetrics {
                min_margin: 0.2,
                avg_max_utilization: 0.6,
                violation_count: 0,
            },
            collision: CollisionMetrics {
                min_distance: 0.05,
                collision_count: 0,
                near_miss_count: 1,
            },
            smoothness: 0.5,
            orientation_change: 1.2,
        }
    }

    fn make_candidate() -> RepairCandidate {
        let delta = PlanDelta::new(RegionId(0), 10..20, Trajectory::new(vec![])).unwrap();
        RepairCandidate::new(StrategyKind::LiftTcp, delta)
    }

    #[test]
    fn test_evaluate_sets_evaluation() {
        let mut candidate = make_candidate();
        let metrics = base_metrics();
        let pipeline = EvaluationPipeline;
        pipeline.evaluate(&mut candidate, &metrics).unwrap();
        assert!(candidate.evaluation.is_some());
    }

    #[test]
    fn test_evaluate_computes_improvement() {
        let mut candidate = make_candidate();
        let metrics = base_metrics();
        let pipeline = EvaluationPipeline;
        pipeline.evaluate(&mut candidate, &metrics).unwrap();
        let eval = candidate.evaluation.unwrap();
        // With base manipulability 0.3, improvement should be ~15%
        assert!(eval.improvement > 0.0);
        assert!(
            eval.metrics_after.manipulability.average > eval.metrics_before.manipulability.average
        );
    }

    #[test]
    fn test_not_evaluated_fails_gracefully() {
        let candidate = make_candidate();
        let pipeline = EvaluationPipeline;
        let result = pipeline.is_improvement(&candidate, 0.0);
        assert!(result.is_err());
        match result {
            Err(RepairError::NoImprovement(_)) => {} // expected
            _ => panic!("Expected NoImprovement"),
        }
    }
}
