use std::sync::RwLock;

use thalos_core::{
    kinematics::{
        forward::{result::FKResult, ForwardKinematics},
        inverse::{result::IKResult, DampedLeastSquaresSolver, IKGoal, IKSolver},
    },
    models::{RobotModel, RobotRegistry},
    robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};
use thalos_planning::motion::program::CompiledPlan;

use crate::backends::RobotBackend;
use crate::commands::handler::ExecutableCommand;
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
        let dof = model.metadata().dof;
        let active_robot = ActiveRobot::new(model, chain, vec![0.0; dof]);
        let robot_name = model.metadata().display_name.to_string();
        let runtime = SceneRuntime::new(active_robot, robot_name);

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

        let ik_result = None;
        Ok(RuntimeSnapshot {
            robot: runtime.active_robot.model,
            robot_source: runtime.robot_source.clone(),
            robot_name: runtime.robot_name.clone(),
            joints_meta: runtime.joints_meta.clone(),
            joints: runtime.active_robot.joints.clone(),
            chain: runtime.active_robot.chain.clone(),
            fk_result,
            ik_result,
            active_plan: runtime.active_plan.clone(),
            execution: runtime.execution.clone(),
            generated_at: chrono::Utc::now(),
        })
    }

    pub fn execute(&self, cmd: Command) -> Result<RuntimeSnapshot, RuntimeError> {
        let ik_result = cmd.execute(&mut *self.runtime.write().unwrap())?;
        self.snapshot_with_ik(ik_result)
    }

    pub fn solve_ik(
        &self,
        frame: FrameId,
        goal: IKGoal,
    ) -> Result<(Vec<f64>, IKResult), RuntimeError> {
        let runtime = self.runtime.read().unwrap();
        let fk = ForwardKinematics::new(runtime.active_robot.chain.clone());
        let solver = DampedLeastSquaresSolver::new(fk, frame, IK_MAX_ITERS, IK_TOLERANCE, IK_LAMBDA);

        let q0 = runtime.active_robot.joints.clone();
        let result = solver.solve(&q0, goal);

        Ok((result.q.clone(), result))
    }

    // ── Multi-segment program (Preview) ──

    /// Compile and store a motion program for preview.
    ///
    /// This does NOT start execution — the plan is stored and visualised,
    /// and the robot stays at its current position.
    pub fn schedule_program(&self, compiled: CompiledPlan) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().unwrap();
            runtime.schedule_plan(compiled);
        }
        self.snapshot_with_ik(None)
    }

    // ── Execution control ──

    /// Start execution of the scheduled plan.
    pub fn start_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().unwrap();
            runtime.start_execution();
        }
        self.snapshot_with_ik(None)
    }

    /// Pause execution.
    pub fn pause_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().unwrap();
            runtime.pause_execution();
        }
        self.snapshot_with_ik(None)
    }

    /// Resume a paused execution.
    pub fn resume_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().unwrap();
            runtime.resume_execution();
        }
        self.snapshot_with_ik(None)
    }

    /// Cancel execution.
    pub fn cancel_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().unwrap();
            runtime.cancel_execution();
        }
        self.snapshot_with_ik(None)
    }

    /// Reset the execution session for re-run.
    pub fn reset_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().unwrap();
            runtime.reset_execution();
        }
        self.snapshot_with_ik(None)
    }

    // ── Tick ──

    /// Advance execution by `dt` seconds and return the updated snapshot.
    pub fn tick_execution(&self, dt: f64) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().unwrap();
            runtime.advance_trajectory(dt);
        }
        self.snapshot_with_ik(None)
    }

    /// Build a snapshot, injecting optional IK metadata.
    fn snapshot_with_ik(&self, ik_result: Option<IKResult>) -> Result<RuntimeSnapshot, RuntimeError> {
        let runtime = self.runtime.read().unwrap();
        let fk_result = Self::compute_fk(&runtime.active_robot.chain, &runtime.active_robot.joints);

        Ok(RuntimeSnapshot {
            robot: runtime.active_robot.model,
            robot_source: runtime.robot_source.clone(),
            robot_name: runtime.robot_name.clone(),
            joints_meta: runtime.joints_meta.clone(),
            joints: runtime.active_robot.joints.clone(),
            chain: runtime.active_robot.chain.clone(),
            fk_result,
            ik_result,
            active_plan: runtime.active_plan.clone(),
            execution: runtime.execution.clone(),
            generated_at: chrono::Utc::now(),
        })
    }
}
