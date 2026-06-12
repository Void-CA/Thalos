use thalos_planning::error::PlanningError;

use crate::app::error::ApiError;

impl From<PlanningError> for ApiError {
    fn from(e: PlanningError) -> Self {
        match e {
            PlanningError::IkFailed { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "ik_failed".into(),
            },
            PlanningError::JointLimitViolation { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "joint_limit_violation".into(),
            },
            PlanningError::InvalidGoal(_) => ApiError::Validation {
                message: e.to_string(),
                code: "invalid_goal".into(),
            },
            PlanningError::UnreachableGoal { .. } => ApiError::Validation {
                message: e.to_string(),
                code: "unreachable_goal".into(),
            },
        }
    }
}
