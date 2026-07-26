use thalos_core::{analysis::region::RegionId, trajectory::Trajectory};

/// Complete report of an optimization run.
#[derive(Debug, Clone)]
pub struct OptimizationReport {
    /// Ordered list of optimization steps performed.
    pub steps: Vec<OptimizationStep>,
    /// The final optimized trajectory, if one was produced.
    pub final_trajectory: Option<Trajectory>,
    /// Total accumulated improvement across all steps.
    pub total_improvement: f32,
}

/// A single optimization step applied to one region.
#[derive(Debug, Clone)]
pub struct OptimizationStep {
    /// Identifier of the region that was optimized.
    pub region_id: RegionId,
    /// Identifier of the operator that was applied.
    pub operator_id: &'static str,
    /// Improvement delta achieved in this step [0.0, 1.0].
    pub improvement: f32,
    /// Whether the step was accepted (improvement exceeded threshold).
    pub accepted: bool,
    /// Iteration number for this region (0-based).
    pub iteration: usize,
}
