use thalos_core::models::RobotModel;

#[derive(Debug, Clone)]
pub enum Command {
    /// Set the joint angles of the active robot.
    SetJoints(Vec<f64>),

    /// Load a robot model.
    LoadRobot(RobotModel),
}
