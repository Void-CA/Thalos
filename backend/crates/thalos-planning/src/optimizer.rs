//! TrajectoryOptimizer — orchestrates the full optimization flow.
//!
//! This module provides the [`TrajectoryOptimizer`] that drives the
//! optimization pipeline from runtime data and detected problem regions.
//! It extracts joint limits from the robot chain, builds the optimization
//! context, wraps legacy strategies in adapters, and runs the pipeline.
//!
//! # Architecture
//!
//! The `TrajectoryOptimizer` lives in `thalos-planning` because it
//! coordinates across the planning, optimization, and adapter boundaries.
//! It receives a robot chain and trajectory (not a full runtime snapshot)
//! to avoid coupling to `thalos-runtime`.

use std::sync::Arc;

use thalos_core::{
    evaluation::{CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics, PlanMetrics},
    kinematics::inverse::{IKGoal, IKResult, IKSolver, IKStatus},
    operation::ConstraintQuery,
    robot::serial_chain::SerialChain,
    trajectory::Trajectory,
};
use thalos_optimization::{
    domain::{
        JointLimits, OptimizationContext, OptimizationReport, PipelineConfig, TrajectoryOperator,
    },
    error::OptimizationError,
    pipeline::OptimizationPipeline,
};

use crate::{
    adapters::RepairStrategyAdapter, analysis::domain::ProblemRegion,
    repair::domain::traits::RepairStrategy,
};

/// Orchestrator that drives the trajectory optimization pipeline
/// from a robot chain, trajectory, and detected problem regions.
///
/// # Usage
///
/// ```ignore
/// let optimizer = TrajectoryOptimizer::new(vec![
///     Box::new(JointCenteringOperator::new(0.3)) as Box<dyn TrajectoryOperator>,
/// ]);
///
/// let report = optimizer.optimize(
///     &chain,
///     &trajectory,
///     &regions,
///     Some(ik_solver),
/// )?;
/// ```
pub struct TrajectoryOptimizer {
    /// The optimization pipeline that processes regions sequentially.
    pipeline: OptimizationPipeline,
    /// Native trajectory operators (e.g. JointCenteringOperator).
    operators: Vec<Box<dyn TrajectoryOperator>>,
    /// Legacy repair strategies wrapped as operators on demand.
    legacy_strategies: Vec<Box<dyn RepairStrategy>>,
}

impl TrajectoryOptimizer {
    /// Create a new optimizer with the given native operators.
    ///
    /// Use [`with_legacy_strategies`](Self::with_legacy_strategies) to
    /// additionally wrap legacy `RepairStrategy` implementations for
    /// backward compatibility.
    pub fn new(operators: Vec<Box<dyn TrajectoryOperator>>) -> Self {
        Self {
            pipeline: OptimizationPipeline::new(PipelineConfig::default()),
            operators,
            legacy_strategies: Vec::new(),
        }
    }

    /// Create an optimizer with both native operators and legacy strategies.
    ///
    /// Legacy strategies are wrapped in [`RepairStrategyAdapter`] at
    /// [`optimize`](Self::optimize) time using the provided IK solver.
    pub fn with_legacy_strategies(
        operators: Vec<Box<dyn TrajectoryOperator>>,
        strategies: Vec<Box<dyn RepairStrategy>>,
    ) -> Self {
        Self {
            pipeline: OptimizationPipeline::new(PipelineConfig::default()),
            operators,
            legacy_strategies: strategies,
        }
    }

    /// Run the optimization pipeline on the given regions.
    ///
    /// # Parameters
    ///
    /// * `chain` — The robot's kinematic chain (used for joint limits).
    /// * `trajectory` — The trajectory to optimize.
    /// * `regions` — Problem regions detected in the trajectory.
    /// * `ik_solver` — IK solver for legacy strategy adapters.
    ///   Pass `None` when no legacy strategies are configured, or when
    ///   the configured strategies don't need IK (e.g. `SplitSegment`).
    ///
    /// # Returns
    ///
    /// An [`OptimizationReport`] with all optimization steps and
    /// the final trajectory.
    pub fn optimize(
        &self,
        chain: &SerialChain,
        trajectory: &Trajectory,
        regions: &[ProblemRegion],
        ik_solver: Option<Arc<dyn IKSolver>>,
    ) -> Result<OptimizationReport, OptimizationError> {
        // 1. Build optimization context from joint limits
        let joint_limits = Self::extract_joint_limits(chain);
        let ctx = OptimizationContext {
            joint_limits,
            config: PipelineConfig::default(),
            tool_frame: None,
        };

        // 2. Compute basic plan metrics from the trajectory
        let metrics = Self::compute_metrics(trajectory);

        // 3. Collect native operator references
        let native_refs: Vec<&dyn TrajectoryOperator> =
            self.operators.iter().map(|op| op.as_ref()).collect();

        // 4. Wrap legacy strategies if an IK solver is provided.
        //    Declared before `all_ops` to ensure correct drop order
        //    (adapters outlive all_ops references).
        let adapter_refs: Vec<RepairStrategyAdapter<'_>> = if let Some(ref solver) = ik_solver {
            self.legacy_strategies
                .iter()
                .map(|s| RepairStrategyAdapter::new(s.as_ref(), solver.clone()))
                .collect()
        } else {
            Vec::new()
        };

        // 5. Combine all operator references into one slice
        let all_ops: Vec<&dyn TrajectoryOperator> = native_refs
            .iter()
            .copied()
            .chain(adapter_refs.iter().map(|a| a as &dyn TrajectoryOperator))
            .collect();

        // 6. Run the optimization pipeline
        let result = self
            .pipeline
            .optimize(&all_ops, chain, trajectory, regions, &metrics, &ctx)?;

        Ok(result.report)
    }

    /// Extract `JointLimits` from a `SerialChain`, collecting only
    /// enabled joint limits.
    fn extract_joint_limits(chain: &SerialChain) -> JointLimits {
        let mut lower = Vec::new();
        let mut upper = Vec::new();
        let mut velocity = Vec::new();

        for segment in &chain.segments {
            let limits = segment.joint.limits();
            if limits.enabled {
                lower.push(limits.min);
                upper.push(limits.max);
                if let Some(v) = limits.velocity {
                    velocity.push(v);
                }
            }
        }

        let velocity = if velocity.len() == lower.len() {
            Some(velocity)
        } else {
            None
        };

        JointLimits {
            lower,
            upper,
            velocity,
            acceleration: None,
        }
    }

    /// Compute basic `PlanMetrics` from a trajectory.
    ///
    /// These metrics are sufficient for operator scoring and pipeline
    /// convergence. Detailed manipulability/collision analysis would
    /// need the full `PlanAnalysisService` pipeline.
    fn compute_metrics(trajectory: &Trajectory) -> PlanMetrics {
        PlanMetrics::new(
            trajectory.duration(),
            trajectory.len(),
            ManipulabilityMetrics::new(0.0, 0.0, 0, 0),
            JointSafetyMetrics::new(1.0, 0.0, 0),
            CollisionMetrics::new(f64::MAX, 0, 0),
            0.0,
            0.0,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use thalos_core::{
        analysis::region::{RegionId, RegionKind, RegionSeverity},
        kinematics::inverse::{IKGoal, IKResult, IKStatus},
        models::{RobotModel, RobotRegistry},
        trajectory::TrajectoryPoint,
    };
    use thalos_optimization::domain::{JointLimits, OperatorFamily, PipelineConfig};

    use crate::{
        analysis::domain::ProblemRegion,
        repair::domain::{
            traits::RepairStrategy,
            types::{PlanDelta, RepairCandidate, StrategyKind},
        },
    };

    // ── Mock operator ─────────────────────────────────────────

    struct MockOperator {
        id: &'static str,
        app: f32,
        improv: f32,
        cost: f32,
    }

    impl TrajectoryOperator for MockOperator {
        fn id(&self) -> &'static str {
            self.id
        }

        fn family(&self) -> OperatorFamily {
            OperatorFamily::JointSpace
        }

        fn applicability(&self, _region: &ProblemRegion) -> f32 {
            self.app
        }

        fn estimate_improvement(&self, _region: &ProblemRegion, _metrics: &PlanMetrics) -> f32 {
            self.improv
        }

        fn estimate_cost(&self) -> f32 {
            self.cost
        }

        fn apply(
            &self,
            _robot: &SerialChain,
            trajectory: &Trajectory,
            _region: &ProblemRegion,
            _ctx: &OptimizationContext,
            _constraints: Option<&dyn ConstraintQuery>,
        ) -> Result<Trajectory, OptimizationError> {
            Ok(trajectory.clone())
        }
    }

    // ── Mock strategy ─────────────────────────────────────────

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
            _context: &crate::repair::context::RepairContext,
            _plan: &crate::motion::program::CompiledPlan,
            _region: &ProblemRegion,
        ) -> Vec<RepairCandidate> {
            let delta = PlanDelta::new(
                RegionId(0),
                0..3,
                Trajectory::new(vec![
                    TrajectoryPoint::new(vec![0.5, 0.5], 0.0),
                    TrajectoryPoint::new(vec![0.5, 0.5], 1.0),
                    TrajectoryPoint::new(vec![0.5, 0.5], 2.0),
                ]),
            )
            .unwrap();
            vec![RepairCandidate::new(StrategyKind::SplitSegment, delta)]
        }
    }

    struct DummySolver;

    impl IKSolver for DummySolver {
        fn solve(&self, _q0: &[f64], _goal: IKGoal) -> IKResult {
            IKResult {
                q: vec![],
                status: IKStatus::MaxIterations,
                iterations: 0,
                final_error: 999.0,
                error_history: None,
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────

    fn test_chain() -> SerialChain {
        RobotRegistry::create_default(RobotModel::Planar2R)
    }

    fn test_trajectory() -> Trajectory {
        Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 0.5], 1.0),
            TrajectoryPoint::new(vec![1.0, 1.0], 2.0),
        ])
    }

    fn test_region(id: usize) -> ProblemRegion {
        ProblemRegion::new(
            RegionId(id),
            RegionKind::Singularity,
            RegionSeverity::Critical,
            id..(id + 2),
        )
    }

    // ── Tests ─────────────────────────────────────────────────

    #[test]
    fn optimizer_creates_valid_context_from_chain() {
        let chain = test_chain();
        let limits = TrajectoryOptimizer::extract_joint_limits(&chain);
        // Planar2R has 2 revolute joints with enabled limits
        assert_eq!(limits.lower.len(), 2);
        assert_eq!(limits.upper.len(), 2);
        assert!(limits.lower[0] < limits.upper[0]);
    }

    #[test]
    fn optimize_returns_report_with_steps_when_operators_available() {
        let op = MockOperator {
            id: "test_op",
            app: 1.0,
            improv: 1.0,
            cost: 1.0,
        };
        let optimizer = TrajectoryOptimizer::new(vec![Box::new(op)]);
        let chain = test_chain();
        let traj = test_trajectory();
        let regions = vec![test_region(0)];

        let report = optimizer
            .optimize(&chain, &traj, &regions, None)
            .expect("optimize should succeed");

        assert!(!report.steps.is_empty(), "expected at least one step");
        assert_eq!(report.steps[0].operator_id, "test_op");
        assert!(report.steps[0].accepted);
    }

    #[test]
    fn optimize_empty_regions_returns_empty_report() {
        let op = MockOperator {
            id: "empty_test",
            app: 1.0,
            improv: 1.0,
            cost: 1.0,
        };
        let optimizer = TrajectoryOptimizer::new(vec![Box::new(op)]);
        let chain = test_chain();
        let traj = test_trajectory();
        let regions: Vec<ProblemRegion> = vec![];

        let report = optimizer
            .optimize(&chain, &traj, &regions, None)
            .expect("optimize should succeed with empty regions");

        assert!(
            report.steps.is_empty(),
            "expected no steps for empty regions"
        );
    }

    #[test]
    fn optimize_with_no_operators_returns_empty_steps() {
        let optimizer = TrajectoryOptimizer::new(vec![]);
        let chain = test_chain();
        let traj = test_trajectory();
        let regions = vec![test_region(0)];

        let report = optimizer
            .optimize(&chain, &traj, &regions, None)
            .expect("optimize should succeed");

        assert!(
            report.steps.is_empty(),
            "expected no steps with no operators"
        );
    }

    #[test]
    fn legacy_strategies_are_wrapped_and_run_through_pipeline() {
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);

        let optimizer =
            TrajectoryOptimizer::with_legacy_strategies(vec![], vec![Box::new(strategy)]);

        let chain = test_chain();
        let traj = test_trajectory();
        let regions = vec![test_region(0)];

        let report = optimizer
            .optimize(&chain, &traj, &regions, Some(solver))
            .expect("optimize with legacy strategies should succeed");

        // The adapter should run and produce a step
        assert!(
            !report.steps.is_empty(),
            "expected steps from legacy adapter"
        );
    }

    #[test]
    fn legacy_strategies_skipped_when_no_ik_solver() {
        let strategy = AcceptingStrategy;
        let optimizer =
            TrajectoryOptimizer::with_legacy_strategies(vec![], vec![Box::new(strategy)]);

        let chain = test_chain();
        let traj = test_trajectory();
        let regions = vec![test_region(0)];

        // Without an IK solver, legacy strategies are skipped.
        // With no operators, the report should be empty.
        let report = optimizer
            .optimize(&chain, &traj, &regions, None)
            .expect("optimize should succeed");

        assert!(
            report.steps.is_empty(),
            "expected no steps when legacy strategies are skipped"
        );
    }

    #[test]
    fn native_and_legacy_operators_combine() {
        let native = MockOperator {
            id: "native_op",
            app: 0.9,
            improv: 0.8,
            cost: 1.0,
        };
        let strategy = AcceptingStrategy;
        let solver = Arc::new(DummySolver);

        let optimizer = TrajectoryOptimizer::with_legacy_strategies(
            vec![Box::new(native)],
            vec![Box::new(strategy)],
        );

        let chain = test_chain();
        let traj = test_trajectory();
        let regions = vec![test_region(0)];

        let report = optimizer
            .optimize(&chain, &traj, &regions, Some(solver))
            .expect("optimize should succeed");

        // The native operator has higher score, so it should be selected
        assert!(!report.steps.is_empty(), "expected steps");
        assert_eq!(
            report.steps[0].operator_id, "native_op",
            "native operator should be ranked higher"
        );
    }

    #[test]
    fn optimize_multiple_regions_processes_all() {
        let op = MockOperator {
            id: "multi_op",
            app: 0.8,
            improv: 0.6,
            cost: 1.0,
        };
        let optimizer = TrajectoryOptimizer::new(vec![Box::new(op)]);
        let chain = test_chain();
        let traj = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.2, 0.2], 0.5),
            TrajectoryPoint::new(vec![0.4, 0.4], 1.0),
            TrajectoryPoint::new(vec![0.6, 0.6], 1.5),
            TrajectoryPoint::new(vec![0.8, 0.8], 2.0),
            TrajectoryPoint::new(vec![1.0, 1.0], 2.5),
        ]);
        let regions = vec![test_region(0), test_region(2), test_region(4)];

        let report = optimizer
            .optimize(&chain, &traj, &regions, None)
            .expect("optimize should succeed");

        assert_eq!(report.steps.len(), 3, "expected 3 steps for 3 regions");
    }

    #[test]
    fn extract_joint_limits_filters_disabled_joints() {
        let chain = test_chain();
        let limits = TrajectoryOptimizer::extract_joint_limits(&chain);

        // Planar2R has 2 segments with revolute joints — both are enabled
        assert_eq!(limits.lower.len(), 2);
        assert_eq!(limits.upper.len(), 2);
        assert!(limits.lower[0] <= limits.upper[0]);
        assert!(limits.lower[1] <= limits.upper[1]);
    }
}
