use thalos_core::{
    kinematics::inverse::IKResult,
    models::{RobotModel, RobotRegistry},
    prelude::ActiveRobot,
};

use crate::{
    commands::{
        handler::ExecutableCommand,
        kinematics::KinematicsCommand,
        motion::MotionCommands,
    },
    state::robot::SceneRuntime,
    RuntimeError,
};

#[derive(Debug, Clone)]
pub enum Command {
    SetJoints(Vec<f64>),
    LoadRobot(RobotModel),
    Kinematics(KinematicsCommand),
    Motion(MotionCommands),
}

impl ExecutableCommand for Command {
    type Output = Option<IKResult>;

    fn execute(&self, runtime: &mut SceneRuntime) -> Result<Option<IKResult>, RuntimeError> {
        match self {
            Command::SetJoints(joints) => {
                runtime.active_robot.joints = joints.clone();
                Ok(None)
            }
            Command::LoadRobot(model) => {
                let dof = model.metadata().dof;
                let chain = RobotRegistry::create_default(*model);
                runtime.active_robot = ActiveRobot::new(*model, chain, vec![0.0; dof]);
                Ok(None)
            }
            Command::Kinematics(cmd) => cmd.execute(runtime).map(Some),
            Command::Motion(cmd) => cmd.execute(runtime),
        }
    }
}
