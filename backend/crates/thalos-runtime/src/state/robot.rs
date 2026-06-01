use thalos_core::{models::RobotModel, prelude::SerialChain};

/// Runtime mutable state: the currently active robot and its joint angles.
pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot) -> Self {
        Self { active_robot }
    }
}

/// A loaded robot with its kinematic chain and current joint configuration.
pub struct ActiveRobot {
    pub model: RobotModel,
    pub chain: SerialChain,
    pub joints: Vec<f64>,
}

impl ActiveRobot {
    pub fn new(model: RobotModel, chain: SerialChain, joints: Vec<f64>) -> Self {
        Self {
            model,
            chain,
            joints,
        }
    }
}
