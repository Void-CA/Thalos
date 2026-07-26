use thalos_core::{
    analysis::region::ProblemRegion,
    evaluation::PlanMetrics,
    robot::serial_chain::SerialChain,
    trajectory::Trajectory,
};

use super::context::OptimizationContext;
use crate::error::OptimizationError;

/// Family classification of an optimization operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OperatorFamily {
    /// Geometry-based operators (e.g. lift TCP, rotate tool).
    Geometry,
    /// Joint-space operators (e.g. joint centering).
    JointSpace,
    /// Temporal operators (e.g. speed reduction, acceleration profiling).
    Temporal,
    /// Sampling-based operators (e.g. re-sample trajectory).
    Sampling,
}

/// A trait representing an operator that can optimize a trajectory region.
///
/// Operators are the atomic unit of optimization work. Each operator
/// knows which region types it applies to, estimates its own impact,
/// and can apply itself to produce an improved trajectory.
pub trait TrajectoryOperator: Send + Sync {
    /// Stable identifier for this operator (e.g. "joint_centering").
    fn id(&self) -> &'static str;

    /// The family this operator belongs to.
    fn family(&self) -> OperatorFamily;

    /// Returns a score in [0.0, 1.0] indicating how applicable this
    /// operator is to the given problem region.
    fn applicability(&self, region: &ProblemRegion) -> f32;

    /// Estimates the expected improvement (0.0–1.0) of applying this
    /// operator to the given region, based on current plan metrics.
    fn estimate_improvement(&self, region: &ProblemRegion, metrics: &PlanMetrics) -> f32;

    /// Estimated computational cost (arbitrary units, higher = more expensive).
    fn estimate_cost(&self) -> f32;

    /// Apply the operator to a trajectory region, producing an optimized
    /// trajectory segment, or returning an error.
    fn apply(
        &self,
        robot: &SerialChain,
        trajectory: &Trajectory,
        region: &ProblemRegion,
        ctx: &OptimizationContext,
    ) -> Result<Trajectory, OptimizationError>;
}
