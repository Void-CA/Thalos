use thalos_core::{
    kinematics::jacobian::{ManipulabilityReport, SingularityReport},
    spatial::pose::Pose,
};

#[derive(Debug, Clone)]
pub struct JointGoal(pub Vec<f64>);

#[derive(Debug, Clone)]
pub struct PoseGoal(pub Pose);

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
