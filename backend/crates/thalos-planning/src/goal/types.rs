use thalos_core::{
    kinematics::jacobian::{ManipulabilityReport, SingularityReport},
    robot::state::RobotState,
    spatial::pose::Pose,
};

#[derive(Debug, Clone)]
pub struct JointGoal(pub Vec<f64>);

/// A pose goal with its IK solution.
#[derive(Debug, Clone)]
pub struct ResolvedPoseGoal {
    pub pose: Pose,
    pub state: RobotState,
}

#[derive(Debug, Clone, Default)]
pub struct GoalMetadata {
    pub singularity: Option<SingularityReport>,
    pub manipulability: Option<ManipulabilityReport>,
    pub joint_limits_applied: bool,
}

#[derive(Debug, Clone)]
pub struct ValidatedGoal<G> {
    pub goal: G,
    pub metadata: GoalMetadata,
}
