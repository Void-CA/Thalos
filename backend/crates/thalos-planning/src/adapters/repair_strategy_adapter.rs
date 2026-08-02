//! RepairStrategyAdapter — wraps a legacy [`RepairStrategy`] as a new
//! [`TrajectoryOperator`] so it can participate in the optimization pipeline.
//!
//! This adapter is an integration concern: it bridges the old
//! `RepairStrategy` trait (in `thalos-planning`) with the new
//! `TrajectoryOperator` trait (in `thalos-optimization`).

use std::sync::Arc;

use thalos_core::operation::ConstraintQuery;
use thalos_core::{
    kinematics::inverse::IKSolver, robot::serial_chain::SerialChain, trajectory::Trajectory,
};
use thalos_optimization::{
    OptimizationContext, PlanMetrics, ProblemRegion, TrajectoryOperator,
    domain::operator::OperatorFamily, error::OptimizationError,
};

use crate::{
    motion::program::CompiledPlan,
    repair::{context::RepairContext, domain::RepairStrategy},
};

/// Wraps a [`RepairStrategy`] to conform to the [`TrajectoryOperator`] interface.
///
/// The adapter delegates `applicability()` to `RepairStrategy::applies_to()`
/// and `apply()` to `RepairStrategy::generate()`, converting the results.
///
/// # IK Solver
///
/// The adapter stores an `IKSolver` because `RepairContext` (required by
/// `RepairStrategy::generate()`) needs one. Strategies that do not use IK
/// (e.g. `SplitSegment`) will work with any solver; IK-based strategies
/// require a properly configured solver matching the robot model.
///
/// In production, the caller (e.g. `TrajectoryOptimizer` in Phase 4)
/// constructs the adapter with the correct solver.
pub struct RepairStrategyAdapter<'a> {
    inner: &'a dyn RepairStrategy,
    ik_solver: Arc<dyn IKSolver>,
}

impl<'a> RepairStrategyAdapter<'a> {
    /// Create a new adapter wrapping the given strategy.
    pub fn new(inner: &'a dyn RepairStrategy, ik_solver: Arc<dyn IKSolver>) -> Self {
        Self { inner, ik_solver }
    }
}

impl TrajectoryOperator for RepairStrategyAdapter<'_> {
    fn id(&self) -> &'static str {
        self.inner.kind().name()
    }

    fn family(&self) -> OperatorFamily {
        OperatorFamily::Geometry
    }

    fn applicability(&self, region: &ProblemRegion) -> f32 {
        if self.inner.applies_to(region) {
            0.7
        } else {
            0.0
        }
    }

    fn estimate_improvement(&self, _region: &ProblemRegion, _metrics: &PlanMetrics) -> f32 {
        // Cannot estimate improvement without actually running the strategy.
        0.0
    }

    fn estimate_cost(&self) -> f32 {
        // Moderate cost — strategies may need IK computation.
        0.5
    }

    fn apply(
        &self,
        robot: &SerialChain,
        traj: &Trajectory,
        region: &ProblemRegion,
        _ctx: &OptimizationContext,
        _constraints: Option<&dyn ConstraintQuery>,
    ) -> Result<Trajectory, OptimizationError> {
        let compiled_plan = CompiledPlan::new(traj.clone(), vec![]);

        let context = RepairContext {
            chain: Arc::new(robot.clone()),
            tcp_frame: *robot.end_effector(),
            ik_solver: self.ik_solver.clone(),
        };

        let candidates = self.inner.generate(&context, &compiled_plan, region);

        candidates
            .into_iter()
            .next()
            .map(|c| c.delta.replacement)
            .ok_or(OptimizationError::NoApplicableOperator)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use thalos_core::{
        analysis::region::{RegionId, RegionKind, RegionSeverity},
        kinematics::inverse::{IKGoal, IKResult, IKStatus, IkError},
        models::{RobotModel, RobotRegistry},
        trajectory::TrajectoryPoint,
    };

    use crate::{
        analysis::domain::ProblemRegion,
        motion::program::CompiledPlan,
        repair::{
            context::RepairContext,
            domain::{
                RepairCandidate,
                types::{PlanDelta, StrategyKind},
            },
        },
    };

    // ── Mock IKSolver (always fails — not used by mock strategy) ──

    struct DummySolver;

    impl IKSolver for DummySolver {
        fn solve(&self, _q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult {
                q: vec![],
                status: IKStatus::MaxIterations,
                iterations: 0,
                final_error: 999.0,
                error_history: None,
            })
        }
    }

    // ── Mock RepairStrategy (returns a fixed candidate) ──

    struct AcceptingStrategy;

    impl RepairStrategy for AcceptingStrategy {
        fn kind(&self) -> StrategyKind {
            StrategyKind::SplitSegment
        }

        fn applies_to(&self, _region: &ProblemRegion) -> bool {
            true
        }

        fn generate(
            &self,
            _context: &RepairContext,
            _plan: &CompiledPlan,
            _region: &ProblemRegion,
        ) -> Vec<RepairCandidate> {
            let delta = PlanDelta::new(
                RegionId(42),
                0..1,
                Trajectory::new(vec![TrajectoryPoint::new(vec![0.5, 0.5], 1.0)]),
            )
            .unwrap();
            vec![RepairCandidate::new(StrategyKind::SplitSegment, delta)]
        }
    }

    struct RejectingStrategy;

    impl RepairStrategy for RejectingStrategy {
        fn kind(&self) -> StrategyKind {
            StrategyKind::SplitSegment
        }

        fn applies_to(&self, _region: &ProblemRegion) -> bool {
            false
        }

        fn generate(
            &self,
            _context: &RepairContext,
            _plan: &CompiledPlan,
            _region: &ProblemRegion,
        ) -> Vec<RepairCandidate> {
            vec![]
        }
    }

    // ── Helpers ───────────────────────────────────────────

    fn test_region() -> ProblemRegion {
        ProblemRegion::new(
            RegionId(0),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            0..3,
        )
    }

    fn test_trajectory() -> Trajectory {
        Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 0.5], 1.0),
            TrajectoryPoint::new(vec![1.0, 1.0], 2.0),
        ])
    }

    fn test_ctx() -> OptimizationContext {
        OptimizationContext {
            joint_limits: thalos_optimization::domain::context::JointLimits {
                lower: vec![-3.14, -3.14],
                upper: vec![3.14, 3.14],
                velocity: None,
                acceleration: None,
            },
            config: thalos_optimization::domain::context::PipelineConfig::default(),
            tool_frame: None,
        }
    }

    // ── Tests ─────────────────────────────────────────────

    #[test]
    fn adapter_id_matches_strategy_kind() {
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        assert_eq!(adapter.id(), "split-segment");
    }

    #[test]
    fn adapter_family_is_geometry() {
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        assert_eq!(adapter.family(), OperatorFamily::Geometry);
    }

    #[test]
    fn adapter_applicability_accepts_when_strategy_applies() {
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        let region = test_region();
        assert!((adapter.applicability(&region) - 0.7).abs() < f32::EPSILON);
    }

    #[test]
    fn adapter_applicability_rejects_when_strategy_does_not_apply() {
        let strategy = RejectingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        let region = test_region();
        assert!((adapter.applicability(&region) - 0.0).abs() < f32::EPSILON);
    }

    #[test]
    fn adapter_apply_returns_trajectory_from_strategy() {
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = test_region();
        let ctx = test_ctx();

        let result = adapter.apply(&robot, &traj, &region, &ctx, None);
        assert!(result.is_ok());

        let opt_traj = result.unwrap();
        assert_eq!(opt_traj.len(), 1);
        assert!((opt_traj.waypoints()[0].timestamp() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn adapter_apply_returns_error_when_no_candidates() {
        let strategy = RejectingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let traj = test_trajectory();
        let region = test_region();
        let ctx = test_ctx();

        let result = adapter.apply(&robot, &traj, &region, &ctx, None);
        assert!(result.is_err());
        match result.unwrap_err() {
            OptimizationError::NoApplicableOperator => {} // expected
            other => panic!("expected NoApplicableOperator, got {:?}", other),
        }
    }

    #[test]
    fn adapter_estimate_cost_is_default() {
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        assert!((adapter.estimate_cost() - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn adapter_estimate_improvement_is_zero() {
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);
        let adapter = RepairStrategyAdapter::new(&strategy, solver);
        let region = test_region();
        let metrics = PlanMetrics::new(
            0.0,
            0,
            thalos_core::evaluation::ManipulabilityMetrics::new(0.0, 0.0, 0, 0),
            thalos_core::evaluation::JointSafetyMetrics::new(1.0, 0.0, 0),
            thalos_core::evaluation::CollisionMetrics::new(1.0, 0, 0),
            0.0,
            0.0,
        );
        assert!((adapter.estimate_improvement(&region, &metrics) - 0.0).abs() < f32::EPSILON);
    }
}
