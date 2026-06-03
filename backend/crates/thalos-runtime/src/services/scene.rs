use std::sync::RwLock;

use thalos_core::{
    kinematics::{
        forward::{result::FKResult, ForwardKinematics},
        inverse::{DampedLeastSquaresSolver, IKGoal, IKSolver},
    },
    models::{RobotModel, RobotRegistry},
    robot::serial_chain::SerialChain,
};

use crate::backends::RobotBackend;
use crate::commands::Command;
use crate::error::RuntimeError;
use crate::snapshots::RuntimeSnapshot;
use crate::state::robot::{ActiveRobot, SceneRuntime};


/// Default IK solver configuration.
const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;


pub struct SceneService {
    runtime: RwLock<SceneRuntime>,
    backend: Box<dyn RobotBackend + Send + Sync>,
}

impl SceneService {
    pub fn new(backend: Box<dyn RobotBackend + Send + Sync>, model: RobotModel) -> Self {
        let chain = RobotRegistry::create_default(model);
        let active_robot = ActiveRobot::new(model, chain, vec![0.0; model.metadata().dof]);
        let runtime = SceneRuntime::new(active_robot);

        Self {
            runtime: RwLock::new(runtime),
            backend,
        }
    }

    fn compute_fk(chain: &SerialChain, joints: &[f64]) -> FKResult {
        let fk = ForwardKinematics::new(chain.clone());
        fk.evaluate(joints)
    }

    /// Returns a snapshot of the current runtime state with FK result.
    pub fn snapshot(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        let runtime = self.runtime.read().unwrap();

        let fk_result = Self::compute_fk(&runtime.active_robot.chain, &runtime.active_robot.joints);

        Ok(RuntimeSnapshot {
            robot: runtime.active_robot.model,
            joints: runtime.active_robot.joints.clone(),
            chain: runtime.active_robot.chain.clone(),
            fk_result,
            generated_at: chrono::Utc::now(),
        })
    }

    /// Applies a command and returns the resulting snapshot.
    pub fn execute(&self, cmd: Command) -> Result<RuntimeSnapshot, RuntimeError> {
        match cmd {
            Command::SetJoints(joints) => {
                let mut runtime = self.runtime.write().unwrap();
                runtime.active_robot.joints = joints;
            }
            Command::LoadRobot(model) => {
                let chain = RobotRegistry::create_default(model);
                let dof = model.metadata().dof;

                let mut runtime = self.runtime.write().unwrap();
                runtime.active_robot = ActiveRobot::new(model, chain, vec![0.0; dof]);
            }
            Command::MoveToPosition { frame, target } => {
                let mut runtime = self.runtime.write().unwrap();

                let fk = ForwardKinematics::new(runtime.active_robot.chain.clone());
                let solver = DampedLeastSquaresSolver::new(
                    fk,
                    frame,
                    IK_MAX_ITERS,
                    IK_TOLERANCE,
                    IK_LAMBDA,
                );

                let q0 = runtime.active_robot.joints.clone();
                let result = solver.solve(&q0, IKGoal::Position(target));

                runtime.active_robot.joints = result.q;
            }
            Command::MoveToPose { frame, target } => {
                let mut runtime = self.runtime.write().unwrap();

                let fk = ForwardKinematics::new(runtime.active_robot.chain.clone());
                let solver = DampedLeastSquaresSolver::new(
                    fk,
                    frame,
                    IK_MAX_ITERS,
                    IK_TOLERANCE,
                    IK_LAMBDA,
                );

                let q0 = runtime.active_robot.joints.clone();
                let result = solver.solve(&q0, IKGoal::Pose(target));

                runtime.active_robot.joints = result.q;
            }
        }

        self.snapshot()
    }
}
