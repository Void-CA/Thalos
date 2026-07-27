use crate::pipeline::trajectory_composer::BlendPolicy;

/// Configuration for the optimization pipeline.
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Maximum iterations attempted per region (default: 3).
    pub max_iterations_per_region: usize,
    /// Minimum improvement threshold to accept a step (default: 0.01).
    pub improvement_threshold: f32,
    /// Centering factor for joint-centering operator (default: 0.3).
    pub centering_factor: f64,
    /// Number of waypoints on each side of a region for boundary blending (default: 5).
    pub blend_window: usize,
    /// Policy for blending modified segments back into the trajectory (default: SmoothStep).
    pub blend_policy: BlendPolicy,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            max_iterations_per_region: 3,
            improvement_threshold: 0.01,
            centering_factor: 0.3,
            blend_window: 5,
            blend_policy: BlendPolicy::SmoothStep,
        }
    }
}

/// Joint limits extracted from a SerialChain, used by operators.
#[derive(Debug, Clone)]
pub struct JointLimits {
    /// Lower joint limits.
    pub lower: Vec<f64>,
    /// Upper joint limits.
    pub upper: Vec<f64>,
}

/// Robot-agnostic optimization context carrying configuration and joint limits.
///
/// Built by the caller (e.g. `TrajectoryOptimizer`) from the robot model
/// and pipeline configuration. Operators consume this context to avoid
/// coupling to the full robot model.
#[derive(Debug, Clone)]
pub struct OptimizationContext {
    /// Joint limits extracted from the robot model.
    pub joint_limits: JointLimits,
    /// Pipeline configuration parameters.
    pub config: PipelineConfig,
}

impl Default for OptimizationContext {
    fn default() -> Self {
        Self {
            joint_limits: JointLimits {
                lower: vec![],
                upper: vec![],
            },
            config: PipelineConfig::default(),
        }
    }
}
