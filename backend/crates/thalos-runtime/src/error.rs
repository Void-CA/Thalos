use thiserror::Error;

use thalos_core::analysis::workspace::WorkspaceError;
use thalos_core::models::RobotModelError;

use thalos_planning::error::PlanningError;

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("robot model error: {0}")]
    RobotModel(#[from] RobotModelError),

    #[error("workspace error: {0}")]
    Workspace(#[from] WorkspaceError),

    #[error("planning error: {0}")]
    Planning(#[from] PlanningError),
}

impl RuntimeError {
    /// Machine-readable error code for the API layer.
    ///
    /// This lets the API return specific error codes (e.g. `joint_limit_violation`,
    /// `ik_failed`) without depending on `thalos-planning` or other implementation
    /// crates directly.
    pub fn error_code(&self) -> &'static str {
        match self {
            RuntimeError::RobotModel(e) => match e {
                RobotModelError::InvalidRobotId { .. } => "invalid_robot_id",
                RobotModelError::ModelSpecMismatch { .. } => "model_spec_mismatch",
            },
            RuntimeError::Workspace(e) => match e {
                WorkspaceError::InvalidSampleCount(_) => "invalid_sample_count",
                WorkspaceError::InvalidTolerance(_) => "invalid_tolerance",
                WorkspaceError::InvalidPoint(_) => "invalid_point",
                WorkspaceError::EmptyWorkspace => "empty_workspace",
            },
            RuntimeError::Planning(e) => match e {
                PlanningError::IkFailed { .. } => "ik_failed",
                PlanningError::JointLimitViolation { .. } => "joint_limit_violation",
                PlanningError::InvalidGoal(_) => "invalid_goal",
                PlanningError::UnreachableGoal { .. } => "unreachable_goal",
            },
        }
    }
}
