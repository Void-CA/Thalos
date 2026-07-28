use thalos_core::{
    kinematics::inverse::IKResult,
    models::{RobotModel, RobotRegistry},
    prelude::ActiveRobot,
    robot::serial_chain::SerialChain,
    robot::tool_frame::ToolFrame,
};

use thalos_models::Robot;

use crate::{
    RuntimeError,
    commands::{handler::ExecutableCommand, kinematics::KinematicsCommand, motion::MotionCommands},
    snapshots::scene::JointMeta,
    state::robot::SceneRuntime,
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
    /// Select or clear the active Tool Center Point (TCP) frame.
    ///
    /// When `Some(tool_frame)`, all analysis and IK default to this TCP.
    /// When `None`, the flange (`chain.end_effector`) is used as the default.
    SelectToolFrame(Option<ToolFrame>),
}

impl ExecutableCommand for Command {
    type Output = Option<IKResult>;

    fn execute(&self, runtime: &mut SceneRuntime) -> Result<Option<IKResult>, RuntimeError> {
        match self {
            Command::SetJoints(joints) => {
                let expected = runtime.active_robot.chain.dof_count();
                if joints.len() != expected {
                    return Err(RuntimeError::JointCountMismatch {
                        expected,
                        received: joints.len(),
                    });
                }
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
                runtime.active_tcp = None; // Clear TCP when changing robot
                Ok(None)
            }
            Command::LoadUrdfRobot {
                name,
                joints_meta,
                chain,
                robot,
            } => {
                let dof = chain.dof_count();
                runtime.active_robot =
                    ActiveRobot::new(URDF_PLACEHOLDER, chain.clone(), vec![0.0; dof]);
                runtime.robot_name = name.clone();
                runtime.joints_meta = joints_meta.clone();
                runtime.robot_source = Some(robot.clone());
                runtime.active_plan = None;
                runtime.active_tcp = None; // Clear TCP when changing robot
                Ok(None)
            }
            Command::Kinematics(cmd) => cmd.execute(runtime).map(Some),
            Command::Motion(cmd) => cmd.execute(runtime),
            Command::SelectToolFrame(tool_frame) => {
                runtime.select_tool_frame(tool_frame.clone())?;
                Ok(None)
            }
        }
    }
}
