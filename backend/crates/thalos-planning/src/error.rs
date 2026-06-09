use thalos_core::spatial::pose::Pose;
use thiserror::Error;

/// Singularities are not represented here — they are reported as
/// [`GoalMetadata`](crate::goal::GoalMetadata) so the caller decides.
#[derive(Error, Debug, Clone)]
pub enum PlanningError {
    #[error("Inverse kinematics failed for target pose")]
    IkFailed {
        target_pose: Pose,
        reason: IkFailureReason,
    },

    #[error("Joint limit violation at joint {joint_index}: value {value} ∉ [{min}, {max}]")]
    JointLimitViolation {
        joint_index: usize,
        value: f64,
        min: f64,
        max: f64,
    },

    #[error("Invalid goal: {0}")]
    InvalidGoal(String),

    #[error("Goal unreachable: {reason}")]
    UnreachableGoal { reason: String },
}

impl From<&str> for PlanningError {
    fn from(msg: &str) -> Self {
        PlanningError::InvalidGoal(msg.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum IkFailureReason {
    MaxIterationsReached,
    NoSolution,
}
