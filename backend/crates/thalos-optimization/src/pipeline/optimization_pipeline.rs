use crate::{
    domain::{
        OptimizationContext, OptimizationReport, OptimizationStep, PipelineConfig,
        TrajectoryOperator,
    },
    error::OptimizationError,
    pipeline::{trajectory_composer::compose_trajectory, OperatorSelector},
};
use thalos_core::{
    analysis::region::ProblemRegion,
    evaluation::PlanMetrics,
    robot::serial_chain::SerialChain,
    trajectory::Trajectory,
};

/// The result of a full pipeline optimization run.
#[derive(Debug, Clone)]
pub struct OptimizationResult {
    /// Detailed report of all optimization steps performed.
    pub report: OptimizationReport,
    /// The final optimized trajectory.
    pub trajectory: Trajectory,
}

/// Iterative optimization pipeline that processes problem regions
/// sequentially, applying the highest-ranked operator to each region.
///
/// For each region the pipeline:
/// 1. Ranks available operators by composite score
/// 2. Attempts the top-ranked operator
/// 3. Blends the modified segment with the original trajectory at boundaries
/// 4. If it succeeds, accepts the result and moves to the next region
/// 5. If it fails, falls back to the next operator in the ranking
/// 6. If all operators fail for a region, records a failed step
#[derive(Debug, Clone)]
pub struct OptimizationPipeline {
    config: PipelineConfig,
}

impl OptimizationPipeline {
    /// Create a new pipeline with the given configuration.
    pub fn new(config: PipelineConfig) -> Self {
        Self { config }
    }

    /// Run the optimization pipeline across all problem regions.
    ///
    /// # Parameters
    /// - `operators`: Slice of operator trait objects to consider
    /// - `robot`: The robot model (passed through to operators)
    /// - `trajectory`: The initial trajectory to optimize
    /// - `regions`: Problem regions detected in the trajectory
    /// - `metrics`: Current plan metrics for scoring
    /// - `ctx`: Optimization context (joint limits, config)
    ///
    /// Returns an `OptimizationResult` containing the report and
    /// the final optimized trajectory.
    pub fn optimize(
        &self,
        operators: &[&dyn TrajectoryOperator],
        robot: &SerialChain,
        trajectory: &Trajectory,
        regions: &[ProblemRegion],
        metrics: &PlanMetrics,
        ctx: &OptimizationContext,
    ) -> Result<OptimizationResult, OptimizationError> {
        let mut current = trajectory.clone();
        let mut steps = Vec::new();
        let total_improvement = 0.0;

        for region in regions {
            let ranked = OperatorSelector::rank(operators, region, metrics);
            if ranked.is_empty() {
                continue;
            }

            let mut region_improved = false;
            for (op, _assessment) in ranked {
                match op.apply(robot, &current, region, ctx) {
                    Ok(new_traj) => {
                        // Blend the modified segment with the original to avoid
                        // boundary discontinuities. Uses the pipeline's configured
                        // window size and policy (default: SmoothStep).
                        let blended = compose_trajectory(
                            &current,         // original trajectory (before this op)
                            &new_traj,        // operator's output (modified)
                            &region.waypoint_range,
                            self.config.blend_window,
                            self.config.blend_policy,
                        );

                        steps.push(OptimizationStep {
                            region_id: region.id,
                            operator_id: op.id(),
                            improvement: 0.0,
                            accepted: true,
                            iteration: 0,
                        });
                        current = blended;
                        region_improved = true;
                        break;
                    }
                    Err(_) => continue,
                }
            }

            if !region_improved {
                steps.push(OptimizationStep {
                    region_id: region.id,
                    operator_id: "none",
                    improvement: 0.0,
                    accepted: false,
                    iteration: 0,
                });
            }
        }

        Ok(OptimizationResult {
            report: OptimizationReport {
                steps,
                final_trajectory: Some(current.clone()),
                total_improvement,
            },
            trajectory: current,
        })
    }
}
