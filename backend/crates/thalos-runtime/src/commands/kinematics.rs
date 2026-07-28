use thalos_core::kinematics::inverse::{IKGoal, IKResult};
use thalos_core::prelude::{FrameId, Pose, Vector3};

use crate::{RuntimeError, commands::handler::ExecutableCommand, state::robot::SceneRuntime};

#[derive(Debug, Clone)]
pub enum KinematicsCommand {
    MoveToPosition { frame: FrameId, target: Vector3 },
    MoveToPose { frame: FrameId, target: Pose },
}

impl ExecutableCommand for KinematicsCommand {
    type Output = IKResult;

    fn execute(&self, runtime: &mut SceneRuntime) -> Result<IKResult, RuntimeError> {
        match self {
            Self::MoveToPosition { frame, target } => {
                Ok(runtime.solve_and_apply_ik(*frame, IKGoal::Position(*target)))
            }
            Self::MoveToPose { frame, target } => {
                Ok(runtime.solve_and_apply_ik(*frame, IKGoal::Pose(target.clone())))
            }
        }
    }
}
