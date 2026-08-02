use thiserror::Error;

use thalos_core::analysis::workspace::WorkspaceError;
use thalos_core::kinematics::inverse::IkError;
use thalos_core::models::RobotModelError;

use thalos_planning::error::PlanningError;

/// Errors specific to the RobotController trait.
#[derive(Error, Debug, PartialEq)]
pub enum ControllerError {
    #[error("controller is already connected")]
    AlreadyConnected,

    #[error("controller is not connected")]
    NotConnected,

    #[error("this capability is not supported by the current controller")]
    UnsupportedCapability,

    #[error("operation timed out")]
    Timeout,

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
}

impl ControllerError {
    pub fn error_code(&self) -> &'static str {
        match self {
            ControllerError::AlreadyConnected => "already_connected",
            ControllerError::NotConnected => "not_connected",
            ControllerError::UnsupportedCapability => "unsupported_capability",
            ControllerError::Timeout => "timeout",
            ControllerError::Protocol(_) => "protocol_error",
            ControllerError::InvalidManifest(_) => "invalid_manifest",
        }
    }
}

impl From<ControllerError> for RuntimeError {
    fn from(e: ControllerError) -> Self {
        match e {
            ControllerError::AlreadyConnected
            | ControllerError::NotConnected
            | ControllerError::UnsupportedCapability
            | ControllerError::Timeout
            | ControllerError::Protocol(_)
            | ControllerError::InvalidManifest(_) => RuntimeError::JointCountMismatch {
                expected: 0,
                received: 0,
            },
        }
    }
}

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("robot model error: {0}")]
    RobotModel(#[from] RobotModelError),

    #[error("workspace error: {0}")]
    Workspace(#[from] WorkspaceError),

    #[error("planning error: {0}")]
    Planning(#[from] PlanningError),

    #[error("IK error: {0}")]
    Ik(#[from] IkError),

    #[error("joint count mismatch: expected {expected}, received {received}")]
    JointCountMismatch { expected: usize, received: usize },

    #[error("tool frame not found: frame {frame_id} does not exist in the robot chain")]
    ToolFrameNotFound { frame_id: u64 },
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
                PlanningError::CollisionDetected { .. } => "collision_detected",
                PlanningError::EmptyProgram => "empty_program",
                PlanningError::InvalidContext(_) => "invalid_context",
                PlanningError::IKFailure { .. } => "ik_failure",
                PlanningError::Ik(e) => match e {
                    IkError::UnsupportedJointType(_) => "unsupported_joint_type",
                },
            },
            RuntimeError::Ik(e) => match e {
                IkError::UnsupportedJointType(_) => "unsupported_joint_type",
            },
            RuntimeError::JointCountMismatch { expected, received } => "joint_count_mismatch",
            RuntimeError::ToolFrameNotFound { .. } => "tool_frame_not_found",
        }
    }
}
