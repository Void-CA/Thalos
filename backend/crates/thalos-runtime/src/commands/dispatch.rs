use thalos_core::{
    kinematics::inverse::IKResult,
    models::{RobotModel, RobotRegistry},
    prelude::ActiveRobot,
    robot::serial_chain::SerialChain,
};

use thalos_models::Robot;

use crate::{
    commands::{
        handler::ExecutableCommand,
        kinematics::KinematicsCommand,
        motion::MotionCommands,
    },
    snapshots::scene::JointMeta,
    state::robot::SceneRuntime,
    RuntimeError,
};

/// Placeholder model used for URDF-imported robots.
///
/// The visual builder only specializes on `RobotModel::Scara`;
/// any non-Scara variant falls through to the generic scene builder.
const URDF_PLACEHOLDER: RobotModel = RobotModel::Planar3R;

#[derive(Debug, Clone)]
pub enum Command {
    SetJoints(Vec<f64>),
    LoadRobot(RobotModel),
    LoadUrdfRobot {
        name: String,
        joints_meta: Vec<JointMeta>,
        chain: SerialChain,
        /// The full URDF model — preserved for visual/collision rendering.
        robot: Robot,
    },
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
                runtime.robot_name = model.metadata().display_name.to_string();
                runtime.joints_meta.clear();
                runtime.active_plan = None;
                Ok(None)
            }
            Command::LoadUrdfRobot { name, joints_meta, chain, robot } => {
                let dof = chain.dof_count();
                runtime.active_robot = ActiveRobot::new(
                    URDF_PLACEHOLDER,
                    chain.clone(),
                    vec![0.0; dof],
                );
                runtime.robot_name = name.clone();
                runtime.joints_meta = joints_meta.clone();
                runtime.robot_source = Some(robot.clone());
                runtime.active_plan = None;
                Ok(None)
            }
            Command::Kinematics(cmd) => cmd.execute(runtime).map(Some),
            Command::Motion(cmd) => cmd.execute(runtime),
        }
    }
}
