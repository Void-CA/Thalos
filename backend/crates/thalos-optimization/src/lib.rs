//! Thalos Optimization Framework
//!
//! A robot-agnostic trajectory optimization crate that provides domain types,
//! operator traits, scoring, and a reusable pipeline for optimizing trajectory
//! regions identified by the planning analysis subsystem.
//!
//! ## Architecture
//!
//! - `domain` — Core domain model: operator trait, scoring, assessment, context, reports
//! - `error` — Optimization error types
//! - `pipeline` — Iterative optimization pipeline (planned, Phase 2)
//! - `operators` — Concrete operator implementations (planned, Phase 3)
//! - `adapters` — Adapter from legacy `RepairStrategy` to `TrajectoryOperator` (planned, Phase 3)

pub mod domain;
pub mod error;

// Re-export the problem region types used by the operator trait.
// These types are defined in thalos-core and re-exported for convenience.
pub use thalos_core::analysis::region::{
    ProblemRegion, RegionEvidence, RegionId, RegionKind, RegionSeverity,
};
pub use thalos_core::evaluation::PlanMetrics;

// Convenience re-exports from domain
pub use domain::{
    JointLimits, OperatorAssessment, OperatorFamily, OperatorScore, OptimizationContext,
    OptimizationReport, OptimizationStep, PipelineConfig, Reason, TrajectoryOperator,
};
pub use error::OptimizationError;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{context::JointLimits, score};
    use std::sync::Arc;
    use thalos_core::{
        analysis::region::{ProblemRegion, RegionId, RegionKind, RegionSeverity},
        evaluation::PlanMetrics,
        models::{RobotModel, RobotRegistry},
        robot::serial_chain::SerialChain,
        trajectory::{Trajectory, TrajectoryPoint},
    };

    /// Mock operator for testing the TrajectoryOperator trait contract.
    struct MockOperator;

    impl TrajectoryOperator for MockOperator {
        fn id(&self) -> &'static str {
            "mock_operator"
        }

        fn family(&self) -> OperatorFamily {
            OperatorFamily::Geometry
        }

        fn applicability(&self, _region: &ProblemRegion) -> f32 {
            0.85
        }

        fn estimate_improvement(&self, _region: &ProblemRegion, _metrics: &PlanMetrics) -> f32 {
            0.6
        }

        fn estimate_cost(&self) -> f32 {
            1.0
        }

        fn apply(
            &self,
            _robot: &SerialChain,
            trajectory: &Trajectory,
            _region: &ProblemRegion,
            _ctx: &OptimizationContext,
        ) -> Result<Trajectory, OptimizationError> {
            Ok(trajectory.clone())
        }
    }

    #[test]
    fn trajectory_operator_trait_is_object_safe() {
        // Trait must be object-safe for dynamic dispatch.
        let op: Arc<dyn TrajectoryOperator> = Arc::new(MockOperator);
        assert_eq!(op.id(), "mock_operator");
        assert_eq!(op.family(), OperatorFamily::Geometry);
        assert!((op.estimate_cost() - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn trajectory_operator_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<MockOperator>();
    }

    #[test]
    fn trajectory_operator_applicability_range() {
        let op = MockOperator;
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            0..5,
        );
        let app = op.applicability(&region);
        assert!((0.0..=1.0).contains(&app));
    }

    #[test]
    fn trajectory_operator_apply_returns_ok() {
        let op = MockOperator;
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
        ]);
        let region = ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            0..1,
        );
        let ctx = OptimizationContext {
            joint_limits: JointLimits {
                lower: vec![-3.14, -3.14],
                upper: vec![3.14, 3.14],
            },
            config: PipelineConfig::default(),
        };

        let result = op.apply(&robot, &traj, &region, &ctx);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 1);
    }

    #[test]
    fn re_export_problem_region() {
        let _region = ProblemRegion::new(
            RegionId(42),
            RegionKind::Collision,
            RegionSeverity::Warning,
            10..20,
        );
    }

    #[test]
    fn re_export_plan_metrics() {
        let _metrics = PlanMetrics::new(
            0.0, 0,
            thalos_core::evaluation::ManipulabilityMetrics::new(0.0, 0.0, 0, 0),
            thalos_core::evaluation::JointSafetyMetrics::new(1.0, 0.0, 0),
            thalos_core::evaluation::CollisionMetrics::new(1.0, 0, 0),
            0.0, 0.0,
        );
    }

    #[test]
    fn re_export_operator_family() {
        let fam = OperatorFamily::JointSpace;
        assert_ne!(fam, OperatorFamily::Geometry);
    }

    #[test]
    fn score_compute_via_domain_module() {
        let s = score::compute_score(1.0, 1.0, 1.0);
        assert!((s - 1.0).abs() < f32::EPSILON);
    }
}
