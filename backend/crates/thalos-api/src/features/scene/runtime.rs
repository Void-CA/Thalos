use thalos_core::{models::RobotModel, prelude::SerialChain};

pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot) -> Self {
        Self {
            active_robot,
        }
    }
}

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