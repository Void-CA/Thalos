//! Strategy LiftTcp — eleva el TCP para mejorar manipulabilidad.
//!
//! Estrategia simplificada que demuestra el pipeline completo:
//! region → candidate → evaluation → merger.
//!
//! Para cada waypoint en la región, aplica un pequeño offset al primer
//! joint articular que afecta la altura del TCP. En M8.2.3+ se reemplazará
//! por IK completo (FK → offset Z → IK).

use crate::{
    analysis::domain::{ProblemRegion, RegionKind},
    evaluation::evaluator::PlanEvaluator,
    motion::program::CompiledPlan,
    repair::context::RepairContext,
    repair::domain::{
        traits::RepairStrategy,
        types::{PlanDelta, RepairCandidate, StrategyKind},
    },
};
use thalos_core::trajectory::{Trajectory, TrajectoryPoint};

/// Estrategia LiftTcp.
///
/// `joint_offset` es el delta en radianes aplicado al primer joint
/// (usualmente el que más afecta la altura del TCP).
pub struct LiftTcpStrategy {
    pub joint_offset: f64,
}

impl LiftTcpStrategy {
    pub fn new(joint_offset: f64) -> Self {
        Self { joint_offset }
    }
}

impl RepairStrategy for LiftTcpStrategy {
    fn kind(&self) -> StrategyKind {
        StrategyKind::LiftTcp
    }

    fn applies_to(&self, region: &ProblemRegion) -> bool {
        matches!(
            region.kind,
            RegionKind::Singularity | RegionKind::LowManipulability
        )
    }

    fn generate(
        &self,
        _context: &RepairContext,
        plan: &CompiledPlan,
        region: &ProblemRegion,
    ) -> Vec<RepairCandidate> {
        let range = region.waypoint_range.clone();
        let segment = match plan.extract_segment(range.clone()) {
            Some(s) => s,
            None => return vec![],
        };

        let original_wps = segment.waypoints();
        let mut new_wps: Vec<TrajectoryPoint> = Vec::with_capacity(original_wps.len());

        for wp in original_wps.iter() {
            let q: Vec<f64> = wp.joints().iter().map(|j| j + self.joint_offset).collect();
            new_wps.push(TrajectoryPoint::new(q, wp.timestamp()));
        }

        let replacement = Trajectory::new(new_wps);
        let delta = match PlanDelta::new(region.id, range, replacement) {
            Ok(d) => d,
            Err(_) => return vec![],
        };

        // Evaluar mejora
        let metrics_before = PlanEvaluator::compute_metrics_from_joints(&segment);
        let metrics_after = PlanEvaluator::compute_metrics_from_joints(&delta.replacement);
        let improvement =
            metrics_after.manipulability.average - metrics_before.manipulability.average;

        let evaluation = crate::repair::domain::RepairEvaluation {
            metrics_before,
            metrics_after,
            score_delta: improvement,
            improvement,
        };

        vec![RepairCandidate::new(StrategyKind::LiftTcp, delta).with_evaluation(evaluation)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::{RegionId, RegionSeverity};
    use thalos_core::trajectory::TrajectoryPoint;

    fn sample_region() -> ProblemRegion {
        ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            5..10,
        )
    }

    fn sample_plan() -> CompiledPlan {
        let points: Vec<TrajectoryPoint> = (0..20)
            .map(|i| TrajectoryPoint::new(vec![i as f64], i as f64))
            .collect();
        CompiledPlan::new(Trajectory::new(points), vec![])
    }

    #[test]
    fn test_lift_tcp_applies_to_singularity() {
        let strategy = LiftTcpStrategy::new(0.05);
        let region = sample_region();
        assert!(strategy.applies_to(&region));
    }

    #[test]
    fn test_lift_tcp_rejects_collision() {
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Collision,
            RegionSeverity::Critical,
            5..10,
        );
        let strategy = LiftTcpStrategy::new(0.05);
        assert!(!strategy.applies_to(&region));
    }

    #[test]
    fn test_lift_tcp_generates_candidate() {
        let strategy = LiftTcpStrategy::new(0.05);
        let plan = sample_plan();
        let region = sample_region();
        let candidates = strategy.generate(&plan, &region);
        assert_eq!(candidates.len(), 1);
        let candidate = &candidates[0];
        assert!(candidate.evaluation.is_some());
        assert_eq!(candidate.strategy, StrategyKind::LiftTcp);
    }
}
