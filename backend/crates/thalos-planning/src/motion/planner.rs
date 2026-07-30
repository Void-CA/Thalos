use thalos_core::{
    execution::program::ExecutionProgram,
    kinematics::inverse::IKSolver,
    models::RobotModel,
    robot::{serial_chain::SerialChain, state::RobotState, tool_frame::ToolFrame},
};

use crate::error::PlanningError;

use super::execution::ExecutionPlan;

// ─── Legacy types (SegmentPlanningContext retains the old contract) ────

/// Legacy planning context for segment-level planning.
///
/// Used by `PlanCompiler`, `MoveJPlanner`, `MoveLPlanner` and the dispatcher
/// in `compiler.rs`. Replaced at the program level by the new owned
/// `PlanningContext`.
pub struct SegmentPlanningContext<'a> {
    pub robot: &'a SerialChain,
    pub current_state: &'a RobotState,
    pub ik_solver: &'a dyn IKSolver,
    /// Active Tool Center Point (TCP) frame.
    ///
    /// When `Some`, singularity and manipulability analysis reference the TCP.
    /// When `None`, reference the flange (end effector).
    pub tcp: Option<&'a ToolFrame>,
}

/// Legacy alias for backward compatibility with external consumers.
#[allow(deprecated)]
pub type PlanningContext<'a> = SegmentPlanningContext<'a>;

/// Legacy alias for the segment-level planning result type.
pub type PlanningResult = Result<thalos_core::trajectory::Trajectory, PlanningError>;

// ─── New types ────────────────────────────────────────────────────────

/// Type alias for a robot joint state (joint position vector).
pub type JointState = Vec<f64>;

/// Program-level planning context.
///
/// Owned data (no lifetimes) so the planner can iterate instructions and
/// mutate internal state without borrowing conflicts.
pub struct PlanningCtx {
    pub initial_state: JointState,
    pub robot: RobotModel,
    pub interpolation: InterpolationConfig,
}

/// Interpolation and discretization configuration for the planner.
#[derive(Debug, Clone)]
pub struct InterpolationConfig {
    /// Time step for trajectory discretization (seconds).
    pub time_step: f64,
    /// Step size for Cartesian linear path interpolation (meters).
    pub cartesian_step: f64,
}

impl Default for InterpolationConfig {
    fn default() -> Self {
        Self {
            time_step: 0.01,
            cartesian_step: 0.01,
        }
    }
}

/// Legacy segment-level planner trait (used by MoveJPlanner, MoveLPlanner).
///
/// Replaced at the program level by the new `MotionPlanner`. Existing segment
/// planners implement this trait while transitioning to internal helpers.
pub trait SegmentPlanner {
    /// The type of goal this planner accepts.
    type Goal: ?Sized;

    /// Plan a trajectory for a single motion goal.
    fn plan<'a>(&self, ctx: &SegmentPlanningContext<'a>, goal: &Self::Goal) -> PlanningResult;
}

/// New program-level motion planner trait.
///
/// Consumes a complete `ExecutionProgram` and produces a single `ExecutionPlan`.
/// Object-safe: no associated types, no generic parameters.
pub trait MotionPlanner {
    /// Plan a complete motion program into an execution plan.
    fn plan(
        &self,
        program: &ExecutionProgram,
        context: &PlanningCtx,
    ) -> Result<ExecutionPlan, PlanningError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::motion::execution::ExecutionSegment;
    use thalos_core::motion::{
        MotionInstruction, MotionMetadata, MotionPose, MotionProfile, MotionTarget, OutputChannel,
        OutputValue,
    };

    // ── Task 4: MotionPlanner trait is object-safe ────────────────────

    #[test]
    fn motion_planner_is_object_safe() {
        // This test verifies that MotionPlanner can be used as Box<dyn MotionPlanner>
        // If the trait were NOT object-safe, this would fail to compile.
        fn accepts_box(_: Box<dyn MotionPlanner>) {}
        // Just verify the function signature compiles (test passes at runtime)
        let _ = accepts_box;
    }

    // ── PlanningCtx construction ──────────────────────────────────────

    #[test]
    fn planning_ctx_holds_initial_state() {
        let ctx = PlanningCtx {
            initial_state: vec![0.0, 0.0],
            robot: RobotModel::Planar2R,
            interpolation: InterpolationConfig::default(),
        };
        assert_eq!(ctx.initial_state, vec![0.0, 0.0]);
        assert_eq!(ctx.robot, RobotModel::Planar2R);
    }

    #[test]
    fn interpolation_config_defaults() {
        let cfg = InterpolationConfig::default();
        assert!((cfg.time_step - 0.01).abs() < 1e-12);
        assert!((cfg.cartesian_step - 0.01).abs() < 1e-12);
    }

    // ── SegmentPlanningContext construction ───────────────────────────

    // Can't easily construct SegmentPlanningContext in unit tests without
    // building a full SerialChain. The safety net proved existing code works.

    // ── PlanningError variants ────────────────────────────────────────

    #[test]
    fn planning_error_empty_program_variant() {
        let err = PlanningError::EmptyProgram;
        assert_eq!(err.to_string(), "Motion program is empty (no instructions)");
    }

    #[test]
    fn planning_error_invalid_context_variant() {
        let err = PlanningError::InvalidContext("missing robot model".into());
        assert_eq!(
            err.to_string(),
            "Planning context is invalid: missing robot model"
        );
    }

    #[test]
    fn planning_error_ik_failure_variant() {
        let err = PlanningError::IKFailure { pose_index: 5 };
        assert_eq!(
            err.to_string(),
            "Inverse kinematics failed for pose index 5"
        );
        match &err {
            PlanningError::IKFailure { pose_index } => {
                assert_eq!(*pose_index, 5);
            }
            _ => panic!("Expected IKFailure"),
        }
    }
}
