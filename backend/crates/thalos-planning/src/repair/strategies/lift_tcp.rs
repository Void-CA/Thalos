//! Strategy LiftTcp — eleva el Tool Center Point mediante IK para
//! mejorar manipulabilidad en regiones de singularidad.
//!
//! Para cada waypoint en la región:
//! 1. FK: obtiene pose actual del TCP
//! 2. Aplica offset Z cartesiano
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
        kinematics::ik_sequence::solve_translation_offset,
    },
};
use thalos_math::Vector3;

/// Estrategia LiftTcp con IK real.
///
/// Aplica un offset cartesiano al TCP y resuelve IK para cada
/// waypoint en la región problemática.
pub struct LiftTcpStrategy {
    /// Offset cartesiano (X, Y, Z).
    pub offset: Vector3,
}

impl LiftTcpStrategy {
    pub fn new(offset: Vector3) -> Self {
        Self { offset }
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
        context: &RepairContext,
        plan: &CompiledPlan,
        region: &ProblemRegion,
    ) -> Vec<RepairCandidate> {
        let range = region.waypoint_range.clone();
        let segment = match plan.extract_segment(range.clone()) {
            Some(s) => s,
            None => return vec![],
        };

        // IK secuencial con offset cartesiano
        let new_trajectory = match solve_translation_offset(
            &context.chain,
            &context.tcp_frame,
            &*context.ik_solver,
            &segment,
            self.offset,
        ) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[lift_tcp] IK failed: {:?}", e);
                return vec![];
            }
        };

        let delta = match PlanDelta::new(region.id, range, new_trajectory) {
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
    use crate::repair::context::RepairContext;
    use std::sync::Arc;
    use thalos_core::{
        models::{RobotModel, RobotRegistry},
        trajectory::{Trajectory, TrajectoryPoint},
    };

    fn sample_region() -> ProblemRegion {
        ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            5..10,
        )
    }

    /// Crea un contexto de reparación para el robot Planar2R.
    fn test_context() -> RepairContext {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let frame = chain.end_effector().clone();
        use thalos_core::kinematics::{
            forward::ForwardKinematics,
            inverse::JacobianTransposeSolver,
        };
        let fk = ForwardKinematics::new(chain.clone());
        let solver = JacobianTransposeSolver::new(fk, frame.clone(), 5000, 1e-4, 0.1);
        RepairContext {
            chain: Arc::new(chain),
            tcp_frame: frame,
            ik_solver: Arc::new(solver),
        }
    }

    /// Crea un plan con una región problemática para Planar2R.
    fn singularity_plan() -> CompiledPlan {
        let mut points = Vec::new();
        for i in 0..20 {
            // Zona de baja manipulabilidad en q1=0.5, q2=0.5 (codo doblado)
            let q = if i >= 5 && i < 10 {
                vec![0.5 + (i - 5) as f64 * 0.02, 0.5 + (i - 5) as f64 * 0.02]
            } else {
                vec![0.5 + i as f64 * 0.1, 0.5 + i as f64 * 0.1]
            };
            points.push(TrajectoryPoint::new(q, i as f64));
        }
        CompiledPlan::new(Trajectory::new(points), vec![])
    }

    #[test]
    fn test_lift_tcp_applies_to_singularity() {
        let strategy = LiftTcpStrategy::new(Vector3::new(0.0, 0.05, 0.0));
        assert!(strategy.applies_to(&sample_region()));
    }

    #[test]
    fn test_lift_tcp_rejects_collision() {
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Collision,
            RegionSeverity::Critical,
            5..10,
        );
        let strategy = LiftTcpStrategy::new(Vector3::new(0.0, 0.05, 0.0));
        assert!(!strategy.applies_to(&region));
    }

    #[test]
    fn test_lift_tcp_ik_execution_attempted() {
        // Verifica que la estrategia ejecuta IK sin panic.
        // La convergencia depende del solver y la configuración.
        let strategy = LiftTcpStrategy::new(Vector3::new(0.0, 0.001, 0.0));
        let ctx = test_context();
        let plan = singularity_plan();
        let region = ProblemRegion::new(RegionId(0), RegionKind::Singularity, RegionSeverity::Critical, 5..10);
        let _ = strategy.generate(&ctx, &plan, &region);
        // IK puede converger o no — el test pasa si no hay panic
    }

    #[test]
    fn test_lift_tcp_ik_impossible_offset_rejected() {
        let strategy = LiftTcpStrategy::new(Vector3::new(0.0, 5.0, 0.0));
        let ctx = test_context();
        let plan = singularity_plan();
        let region = ProblemRegion::new(RegionId(0), RegionKind::Singularity, RegionSeverity::Critical, 5..10);
        let candidates = strategy.generate(&ctx, &plan, &region);
        assert!(candidates.is_empty(), "Impossible offset should produce no candidates");
    }

    #[test]
    fn test_lift_tcp_infrastructure_validation() {
        // Valida el pipeline infrastructure: extraer segmento, crear delta, merge
        let plan = singularity_plan();
        let segment = plan.extract_segment(5..10).expect("segment exists");
        let delta = PlanDelta::new(RegionId(0), 5..10, segment)
            .expect("valid delta");
        let merged = crate::repair::merger::PlanMerger::apply(&plan, &delta)
            .expect("PlanMerger accepts self-replacement");
        assert_eq!(merged.merged_trajectory.len(), plan.merged_trajectory.len());
    }
}
