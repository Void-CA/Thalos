use crate::models::RobotModel;

use super::serial_chain::SerialChain;

/// A loaded robot with its kinematic identity, chain description,
/// and current joint configuration.
///
/// This is the canonical representation of "the robot that is currently
/// loaded" across all subsystems: planning, execution, visualisation,
/// analysis, and runtime.
#[derive(Debug, Clone)]
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
