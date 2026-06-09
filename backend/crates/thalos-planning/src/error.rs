use thalos_core::{prelude::RobotState, spatial::pose::Pose};
use thiserror::Error;

#[derive(Error, Debug, Clone)]
pub enum PlanningError {
    #[error("Inverse kinematics failed")]
    IkFailed {
        target_pose: Pose,
        reason: IkFailureReason,
    },

    #[error("Singular configuration encountered")]
    SingularConfiguration {
        state: RobotState,
    },

    #[error("Joint limit violation")]
    JointLimitViolation {
        joint_index: usize,
        value: f64,
        min: f64,
        max: f64,
    },

    #[error("Invalid goal specified")]
    InvalidGoal,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum IkFailureReason {
    NoSolution,
    MaxIterationsReached,
    JointLimitViolation,
}