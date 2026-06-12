use thalos_core::kinematics::inverse::IKResult;

use crate::{RuntimeError, commands::handler::ExecutableCommand, state::robot::SceneRuntime};

#[derive(Debug, Clone)]
pub enum MotionCommands {
    MoveJ {
        target: Vec<f64>,
    },
}

impl ExecutableCommand for MotionCommands {
    type Output = Option<IKResult>;

    fn execute(&self, runtime: &mut SceneRuntime) -> Result<Option<IKResult>, RuntimeError> {
        match self {
            Self::MoveJ { target } => {
                runtime.active_robot.joints = target.clone();
                Ok(None)
            }
        }
    }
}