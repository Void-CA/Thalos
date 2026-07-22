//! Strategy RotateTool — rota la orientación del TCP para mejorar
//! manipulabilidad en regiones problemáticas.
//!
//! Para cada waypoint en la región:
//! 1. FK: obtiene pose actual del TCP
//! 2. Aplica rotación alrededor del eje Z del TCP
//! 3. IK: resuelve nueva configuración articular
//! 4. Si IK falla → descarta el candidato

use crate::{
    analysis::domain::{ProblemRegion, RegionKind},
    evaluation::evaluator::PlanEvaluator,
    motion::program::CompiledPlan,
    repair::{
        context::RepairContext,
        domain::{
            traits::RepairStrategy,
            types::{PlanDelta, RepairCandidate, StrategyKind},
        },
        kinematics::ik_sequence::solve_rotation_offset,
    },
};

/// Estrategia que rota el TCP para mejorar manipulabilidad.
pub struct RotateToolStrategy {
    /// Ángulo de rotación en radianes (alrededor del eje Z del TCP).
    pub angle_rad: f64,
}

impl RotateToolStrategy {
    pub fn new(angle_rad: f64) -> Self {
        Self { angle_rad }
    }
}

impl RepairStrategy for RotateToolStrategy {
    fn kind(&self) -> StrategyKind {
        StrategyKind::RotateTool
    }

    fn applies_to(&self, region: &ProblemRegion) -> bool {
        matches!(
            region.kind,
            RegionKind::Singularity | RegionKind::LowManipulability
        )
    }

    fn generate(
        &self,
        context: &RepairContext,
        plan: &CompiledPlan,
        region: &ProblemRegion,
    ) -> Vec<RepairCandidate> {
        let range = region.waypoint_range.clone();
        let segment = match plan.extract_segment(range.clone()) {
            Some(s) => s,
            None => return vec![],
        };

        let new_trajectory = match solve_rotation_offset(
            &context.chain,
            &context.tcp_frame,
            &*context.ik_solver,
            &segment,
            self.angle_rad,
        ) {
            Ok(t) => t,
            Err(_) => return vec![],
        };

        let delta = match PlanDelta::new(region.id, range, new_trajectory) {
            Ok(d) => d,
            Err(_) => return vec![],
        };

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

        vec![RepairCandidate::new(StrategyKind::RotateTool, delta)
            .with_evaluation(evaluation)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::{RegionId, RegionSeverity};

    #[test]
    fn test_rotate_tool_applies_to_singularity() {
        let strategy = RotateToolStrategy::new(0.1);
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            5..10,
        );
        assert!(strategy.applies_to(&region));
    }

    #[test]
    fn test_rotate_tool_rejects_collision() {
        let strategy = RotateToolStrategy::new(0.1);
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Collision,
            RegionSeverity::Critical,
            5..10,
        );
        assert!(!strategy.applies_to(&region));
    }
}
