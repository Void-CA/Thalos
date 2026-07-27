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

/// High-level optimization objective of an operator.
///
/// Operators declare their primary goal through this enum, enabling
/// the pipeline to select operators that align with the current
/// optimization strategy.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OptimizationObjective {
    /// Produce a feasible (valid) trajectory.
    #[default]
    Feasibility,
    /// Produce a smooth trajectory (low jerk/acceleration).
    Smoothness,
    /// Produce a continuous path (well-sampled, no gaps).
    Continuity,
    /// Produce an efficient trajectory (low time/energy).
    Efficiency,
    /// Produce a safe trajectory (max margins).
    Safety,
}

/// Behavioral invariants that an operator guarantees.
///
/// Operators declare which properties they preserve. The pipeline
/// can use this information to reason about operator composition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Invariant {
    /// Existing waypoints are never modified, reordered, or removed.
    PreserveExistingWaypoints,
    /// The start waypoint of the trajectory is preserved.
    PreserveStart,
    /// The end waypoint of the trajectory is preserved.
    PreserveEnd,
    /// Timestamps remain monotonically non-decreasing.
    MonotonicTimestamps,
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

    /// Returns the primary optimization objective of this operator.
    ///
    /// Default: returns `OptimizationObjective::Feasibility`.
    fn objective(&self) -> OptimizationObjective {
        OptimizationObjective::default()
    }

    /// Returns the behavioral invariants that this operator guarantees.
    ///
    /// Default: returns an empty slice (no invariants declared).
    fn invariants(&self) -> &'static [Invariant] {
        &[]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── OptimizationObjective tests ────────────────────────

    #[test]
    fn optimization_objective_continuity_is_distinct() {
        assert_ne!(
            OptimizationObjective::Continuity,
            OptimizationObjective::Safety
        );
        assert_ne!(
            OptimizationObjective::Continuity,
            OptimizationObjective::Efficiency
        );
    }

    #[test]
    fn optimization_objective_default_is_feasibility() {
        assert_eq!(
            OptimizationObjective::default(),
            OptimizationObjective::Feasibility
        );
    }

    #[test]
    fn optimization_objective_exhaustive_match() {
        let objectives = [
            OptimizationObjective::Feasibility,
            OptimizationObjective::Smoothness,
            OptimizationObjective::Continuity,
            OptimizationObjective::Efficiency,
            OptimizationObjective::Safety,
        ];
        for obj in &objectives {
            match obj {
                OptimizationObjective::Feasibility
                | OptimizationObjective::Smoothness
                | OptimizationObjective::Continuity
                | OptimizationObjective::Efficiency
                | OptimizationObjective::Safety => {}
            }
        }
    }

    // ── Invariant tests ────────────────────────────────────

    #[test]
    fn invariant_variants_are_distinct() {
        assert_ne!(
            Invariant::PreserveExistingWaypoints,
            Invariant::PreserveStart
        );
        assert_ne!(Invariant::PreserveExistingWaypoints, Invariant::PreserveEnd);
        assert_ne!(Invariant::PreserveStart, Invariant::PreserveEnd);
        assert_ne!(Invariant::PreserveStart, Invariant::MonotonicTimestamps);
    }

    #[test]
    fn invariant_exhaustive_match() {
        let invariants = [
            Invariant::PreserveExistingWaypoints,
            Invariant::PreserveStart,
            Invariant::PreserveEnd,
            Invariant::MonotonicTimestamps,
        ];
        for inv in &invariants {
            match inv {
                Invariant::PreserveExistingWaypoints
                | Invariant::PreserveStart
                | Invariant::PreserveEnd
                | Invariant::MonotonicTimestamps => {}
            }
        }
    }
}
