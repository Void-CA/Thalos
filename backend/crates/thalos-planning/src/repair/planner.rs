//! RepairPlanner — orquesta estrategias de reparación sobre regiones.
//!
//! Flujo:
//! 1. Por cada región, selecciona estrategias aplicables
//! 2. Genera candidatos
//! 3. Evalúa y rankea
//! 4. Produce RepairPlan con candidato recomendado

use crate::{
    analysis::domain::ProblemRegion,
    motion::program::CompiledPlan,
    repair::{
        context::RepairContext,
        domain::{
            traits::RepairStrategy,
            types::{RepairCandidate, RepairPlan, RepairPlanStatus},
        },
        evaluation::EvaluationPipeline,
        merger::PlanMerger,
    },
};

/// Orquestador de reparaciones.
///
/// No depende del robot — las capacidades cinemáticas se inyectan
/// via `RepairContext` en `plan()`.
#[deprecated(
    note = "Use TrajectoryOptimizer + OptimizationPipeline from thalos-optimization instead. RepairPlanner will be removed after M10."
)]
pub struct RepairPlanner {
    strategies: Vec<Box<dyn RepairStrategy>>,
    evaluator: EvaluationPipeline,
    merger: PlanMerger,
}

impl RepairPlanner {
    pub fn new(strategies: Vec<Box<dyn RepairStrategy>>) -> Self {
        Self {
            strategies,
            evaluator: EvaluationPipeline,
            merger: PlanMerger,
        }
    }

    /// Planifica reparaciones para un conjunto de regiones.
    ///
    /// Devuelve un `RepairPlan` por región, incluyendo regiones sin
    /// reparación posible (con `status` indicando la razón).
    pub fn plan(
        &self,
        plan: &CompiledPlan,
        regions: &[ProblemRegion],
        context: &RepairContext,
    ) -> Vec<RepairPlan> {
        regions
            .iter()
            .map(|region| self.plan_for_region(plan, region, context))
            .collect()
    }

    fn plan_for_region(
        &self,
        plan: &CompiledPlan,
        region: &ProblemRegion,
        context: &RepairContext,
    ) -> RepairPlan {
        // 1. Seleccionar estrategias aplicables
        let applicable: Vec<&Box<dyn RepairStrategy>> = self
            .strategies
            .iter()
            .filter(|s| s.applies_to(region))
            .collect();

        if applicable.is_empty() {
            return RepairPlan {
                recommendations: vec![],
                region: region.clone(),
                candidates: vec![],
                recommended: None,
                status: RepairPlanStatus::NoStrategyApplicable,
            };
        }

        // 2. Generar candidatos
        let mut candidates: Vec<RepairCandidate> = applicable
            .iter()
            .flat_map(|s| s.generate(context, plan, region))
            .collect();

        if candidates.is_empty() {
            return RepairPlan {
                recommendations: vec![],
                region: region.clone(),
                candidates: vec![],
                recommended: None,
                status: RepairPlanStatus::AllStrategiesFailed,
            };
        }

        // 3. Evaluar candidatos (asignar métricas before/after)
        // TODO: Obtener métricas originales del plan
        // let original_metrics = PlanEvaluator::compute_metrics_from_joints(...);
        for candidate in &mut candidates {
            // TODO: usar EvaluationPipeline completo con métricas reales
            if candidate.evaluation.is_none() {
                let _ = self.evaluator.evaluate(
                    candidate,
                    &crate::evaluation::metrics::PlanMetrics {
                        length: 0.0,
                        waypoint_count: 0,
                        manipulability: crate::evaluation::metrics::ManipulabilityMetrics {
                            min: 0.0,
                            average: 0.0,
                            near_singular_count: 0,
                            singular_count: 0,
                        },
                        joint_safety: crate::evaluation::metrics::JointSafetyMetrics {
                            min_margin: 0.0,
                            avg_max_utilization: 0.0,
                            violation_count: 0,
                        },
                        collision: crate::evaluation::metrics::CollisionMetrics {
                            min_distance: 0.0,
                            collision_count: 0,
                            near_miss_count: 0,
                        },
                        smoothness: 0.0,
                        orientation_change: 0.0,
                    },
                );
            }
        }

        // 4. Rankear: mejor improvement primero
        candidates.sort_by(|a, b| {
            let imp_a = a.evaluation.as_ref().map(|e| e.improvement).unwrap_or(-1.0);
            let imp_b = b.evaluation.as_ref().map(|e| e.improvement).unwrap_or(-1.0);
            imp_b
                .partial_cmp(&imp_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let recommended = if candidates
            .first()
            .map(|c| {
                c.evaluation
                    .as_ref()
                    .map(|e| e.improvement > 0.0)
                    .unwrap_or(false)
            })
            .unwrap_or(false)
        {
            Some(0)
        } else {
            None
        };

        RepairPlan {
            recommendations: vec![],
            region: region.clone(),
            candidates,
            recommended,
            status: RepairPlanStatus::Available,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::{RegionId, RegionKind, RegionSeverity};
    use crate::repair::domain::types::{PlanDelta, RepairCandidate, StrategyKind};
    use std::sync::Arc as _Arc;
    use thalos_core::trajectory::Trajectory;

    struct TestStrategy;
    impl RepairStrategy for TestStrategy {
        fn kind(&self) -> StrategyKind {
            StrategyKind::LiftTcp
        }
        fn applies_to(&self, r: &ProblemRegion) -> bool {
            r.kind == RegionKind::Singularity
        }
        fn generate(
            &self,
            _ctx: &RepairContext,
            _plan: &CompiledPlan,
            region: &ProblemRegion,
        ) -> Vec<RepairCandidate> {
            if let Ok(delta) = PlanDelta::new(
                region.id,
                region.waypoint_range.clone(),
                Trajectory::new(vec![]),
            ) {
                vec![RepairCandidate::new(StrategyKind::LiftTcp, delta)]
            } else {
                vec![]
            }
        }
    }

    #[test]
    fn test_planner_empty_regions() {
        let planner = RepairPlanner::new(vec![]);
        let plan = CompiledPlan::new(Trajectory::new(vec![]), vec![]);
        // Context not used for empty regions — create a dummy one
        use crate::repair::context::RepairContext;
        use thalos_core::models::{RobotModel, RobotRegistry};
        let chain = std::sync::Arc::new(RobotRegistry::create_default(RobotModel::Planar2R));
        let frame = chain.end_effector().clone();
        use std::sync::Arc as _Arc;
        use thalos_core::kinematics::{
            forward::ForwardKinematics, inverse::JacobianTransposeSolver,
        };
        let fk = ForwardKinematics::new((*chain).clone());
        let solver = JacobianTransposeSolver::new(fk, frame.clone(), 50, 1e-3, 0.5);
        let ctx = RepairContext {
            chain: chain.clone(),
            tcp_frame: frame,
            ik_solver: _Arc::new(solver),
        };
        let results = planner.plan(&plan, &[], &ctx);
        assert!(results.is_empty());
    }
}
