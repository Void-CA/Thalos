use std::sync::Arc;

use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        inverse::{
            solver::{IKGoal, IKSolver},
            DampedLeastSquaresSolver,
        },
    },
    robot::serial_chain::SerialChain,
    spatial::pose::Pose,
    trajectory::{Trajectory, TrajectoryPoint},
};
use thalos_math::{Transform3D, Vector3};

use crate::{
    analysis::domain::{ProblemRegion, RegionKind},
    evaluation::evaluator::PlanEvaluator,
    motion::program::CompiledPlan,
    repair::domain::{
        traits::RepairStrategy,
        types::{PlanDelta, RepairCandidate, StrategyKind},
    },
};

/// Estrategia que eleva el Tool Center Point para mejorar manipulabilidad.
pub struct LiftTcpStrategy {
    pub offset: Vector3,
    chain: Arc<SerialChain>,
}

impl LiftTcpStrategy {
    pub fn new(offset: Vector3, chain: Arc<SerialChain>) -> Self {
        Self { offset, chain }
    }

    fn try_repair(&self, plan: &CompiledPlan, region: &ProblemRegion) -> Option<RepairCandidate> {
        let range = region.waypoint_range.clone();
        let segment = plan.extract_segment(range.clone())?;
        let original_wps = segment.waypoints();
        let fk_solver = ForwardKinematics::new((*self.chain).clone());
        let ik_solver = DampedLeastSquaresSolver::default();

        let mut new_wps = Vec::with_capacity(original_wps.len());

        for (i, wp) in original_wps.iter().enumerate() {
            let q = wp.joints().to_vec();
            let timestamp = wp.timestamp();

            // FK: obtener pose actual del TCP
            let fk_result = fk_solver.evaluate(&q);
            let current_pose = fk_result.ee_pose()?;
            let trans = current_pose.translation();
            let rot = current_pose.transform().rotation;

            // Aplicar offset Z
            let new_trans = trans + self.offset;
            let new_pose = Pose::new(
                current_pose.reference_id(),
                current_pose.target_id(),
                Transform3D {
                    translation: new_trans,
                    rotation: rot,
                },
            );

            // IK: resolver nueva configuración
            let ik_result = ik_solver.solve(&q, IKGoal::Pose(new_pose)).ok()?;
            new_wps.push(TrajectoryPoint::new(ik_result.q, timestamp));
        }

        let replacement = Trajectory::new(new_wps);
        let delta = PlanDelta::new(region.id, range, replacement).ok()?;

        // Evaluar mejora
        let metrics_before = PlanEvaluator::compute_metrics_from_joints(&segment);
        let metrics_after = PlanEvaluator::compute_metrics_from_joints(&delta.replacement);
        let improvement = metrics_after.manipulability.average
            - metrics_before.manipulability.average;

        let evaluation = crate::repair::domain::RepairEvaluation {
            metrics_before,
            metrics_after,
            score_delta: improvement,
            improvement,
        };

        Some(RepairCandidate::new(StrategyKind::LiftTcp, delta).with_evaluation(evaluation))
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

    fn generate(&self, plan: &CompiledPlan, region: &ProblemRegion) -> Vec<RepairCandidate> {
        match self.try_repair(plan, region) {
            Some(candidate) => vec![candidate],
            None => vec![],
        }
    }
}
