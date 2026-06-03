use thalos_core::{
    math::geometry::vectors::Vector3,
    models::RobotModel,
    spatial::frame::FrameId,
    spatial::pose::Pose,
};

#[derive(Debug, Clone)]
pub enum Command {
    /// Set the joint angles of the active robot.
    SetJoints(Vec<f64>),

    /// Load a robot model.
    LoadRobot(RobotModel),

    /// Move a specific frame to a target position (3-DOF IK).
    MoveToPosition {
        /// Which frame to control (typically the end effector).
        frame: FrameId,
        /// Target position in world coordinates.
        target: Vector3,
    },

    /// Move a specific frame to a target pose (6-DOF IK).
    MoveToPose {
        /// Which frame to control (typically the end effector).
        frame: FrameId,
        /// Target pose (position + orientation) relative to world.
        target: Pose,
    },
}
