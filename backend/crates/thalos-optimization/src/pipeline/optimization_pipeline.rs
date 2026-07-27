use crate::{
    domain::{
        OptimizationContext, OptimizationReport, OptimizationStep, PipelineConfig,
        TrajectoryOperator,
    },
    error::OptimizationError,
    pipeline::{
        acceptance::AcceptancePolicy, trajectory_composer::compose_trajectory, OperatorSelector,
    },
    ProblemRegion, RegionId, RegionKind, RegionSeverity,
};
use thalos_core::{
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
/// 2. Attempts the top-ranked operator → produces a **candidate**
/// 3. Blends the modified segment with the original trajectory at boundaries
/// 4. **Evaluates** the candidate with `AcceptancePolicy` — if metrics
///    degraded, rejects and tries the next operator
/// 5. If accepted, moves to the next region
/// 6. If all operators fail or are rejected, records a failed step
///    with the rejection reason from the last attempted operator.
///
/// After all geometric regions are processed, runs a **temporal post-pass**
/// (Retime) on the full trajectory if the operator is available.
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
        let policy = AcceptancePolicy::default();

        // ── Phase 1: Geometric optimization (per-region, with acceptance) ──
        for region in regions {
            let ranked = OperatorSelector::rank(operators, region, metrics);
            if ranked.is_empty() {
                continue;
            }

            let mut accepted_step: Option<OptimizationStep> = None;
            let mut last_rejection: Option<OptimizationStep> = None;

            for (op, _assessment) in ranked {
                // Skip temporal operators in the geometric pass — they run
                // as a mandatory post-pass.
                if op.family() == crate::domain::operator::OperatorFamily::Temporal {
                    last_rejection = Some(OptimizationStep {
                        region_id: region.id,
                        operator_id: op.id(),
                        improvement: 0.0,
                        accepted: false,
                        iteration: 0,
                        rejection_reason: Some("deferred to temporal post-pass".into()),
                    });
                    continue;
                }

                match op.apply(robot, &current, region, ctx) {
                    Ok(candidate_raw) => {
                        let blended = compose_trajectory(
                            &current,
                            &candidate_raw,
                            &region.waypoint_range,
                            self.config.blend_window,
                            self.config.blend_policy,
                        );

                        let evaluation = policy.evaluate(&current, &blended, ctx);

                        if evaluation.accepted {
                            accepted_step = Some(OptimizationStep {
                                region_id: region.id,
                                operator_id: op.id(),
                                improvement: 0.0,
                                accepted: true,
                                iteration: 0,
                                rejection_reason: None,
                            });
                            current = blended;
                            break;
                        } else {
                            last_rejection = Some(OptimizationStep {
                                region_id: region.id,
                                operator_id: op.id(),
                                improvement: 0.0,
                                accepted: false,
                                iteration: 0,
                                rejection_reason: Some(format!(
                                    "rejected: {}",
                                    evaluation.reason
                                )),
                            });
                        }
                    }
                    Err(e) => {
                        last_rejection = Some(OptimizationStep {
                            region_id: region.id,
                            operator_id: op.id(),
                            improvement: 0.0,
                            accepted: false,
                            iteration: 0,
                            rejection_reason: Some(format!("error: {}", e)),
                        });
                    }
                }
            }

            // Push exactly ONE step per region
            if let Some(accepted) = accepted_step {
                steps.push(accepted);
            } else if let Some(rejected) = last_rejection {
                steps.push(rejected);
            } else {
                steps.push(OptimizationStep {
                    region_id: region.id,
                    operator_id: "none",
                    improvement: 0.0,
                    accepted: false,
                    iteration: 0,
                    rejection_reason: None,
                });
            }
        }

        // ── Phase 2: Temporal post-pass (Retime on full trajectory) ──
        if let Some(retime_op) = operators.iter().find(|op| op.id() == "retime") {
            let full_range = ProblemRegion::new(
                RegionId(usize::MAX),
                RegionKind::Velocity,
                RegionSeverity::Info,
                0..current.len(),
            );

            match retime_op.apply(robot, &current, &full_range, ctx) {
                Ok(retimed) => {
                    let blended = compose_trajectory(
                        &current,
                        &retimed,
                        &full_range.waypoint_range,
                        self.config.blend_window,
                        self.config.blend_policy,
                    );
                    let eval = policy.evaluate(&current, &blended, ctx);
                    if eval.accepted {
                        steps.push(OptimizationStep {
                            region_id: full_range.id,
                            operator_id: "retime",
                            improvement: 0.0,
                            accepted: true,
                            iteration: 0,
                            rejection_reason: None,
                        });
                        current = blended;
                    } else {
                        steps.push(OptimizationStep {
                            region_id: full_range.id,
                            operator_id: "retime",
                            improvement: 0.0,
                            accepted: false,
                            iteration: 0,
                            rejection_reason: Some(eval.reason),
                        });
                    }
                }
                Err(e) => {
                    steps.push(OptimizationStep {
                        region_id: full_range.id,
                        operator_id: "retime",
                        improvement: 0.0,
                        accepted: false,
                        iteration: 0,
                        rejection_reason: Some(format!("error: {}", e)),
                    });
                }
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
