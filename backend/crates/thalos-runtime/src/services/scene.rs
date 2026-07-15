use std::sync::Arc;

use tokio::sync::RwLock;

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

use crate::backends::manager::BackendManager;
use crate::backends::RobotBackend;
use crate::commands::handler::ExecutableCommand;
use crate::commands::Command;
use crate::error::RuntimeError;
use crate::snapshots::{RuntimeSnapshot, TickDelta};
use crate::state::robot::{ActiveRobot, SceneRuntime};

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

pub struct SceneService {
    runtime: RwLock<SceneRuntime>,
    backend: Box<dyn RobotBackend + Send + Sync>,
    manager: Arc<BackendManager>,
}

impl SceneService {
    pub fn new(
        backend: Box<dyn RobotBackend + Send + Sync>,
        manager: Arc<BackendManager>,
        model: RobotModel,
    ) -> Self {
        let chain = RobotRegistry::create_default(model);
        let dof = model.metadata().dof;
        let active_robot = ActiveRobot::new(model, chain, vec![0.0; dof]);
        let robot_name = model.metadata().display_name.to_string();
        let runtime = SceneRuntime::new(active_robot, robot_name);

        Self {
            runtime: RwLock::new(runtime),
            backend,
            manager,
        }
    }

    fn compute_fk(chain: &SerialChain, joints: &[f64]) -> FKResult {
        let fk = ForwardKinematics::new(chain.clone());
        fk.evaluate(joints)
    }

    fn build_snapshot(
        runtime: &SceneRuntime,
        ik_result: Option<IKResult>,
    ) -> RuntimeSnapshot {
        let fk_result = Self::compute_fk(&runtime.active_robot.chain, &runtime.active_robot.joints);

        RuntimeSnapshot {
            robot: runtime.active_robot.model,
            robot_source: runtime.robot_source.clone(),
            robot_name: runtime.robot_name.clone(),
            joints_meta: runtime.joints_meta.clone(),
            joints: runtime.active_robot.joints.clone(),
            chain: runtime.active_robot.chain.clone(),
            fk_result,
            ik_result,
            active_plan: runtime.active_plan.clone(),
            execution: None,
            active_tcp: runtime.active_tcp.clone(),
            generated_at: chrono::Utc::now(),
        }
    }

    /// Read-only snapshot (no IK metadata).
    pub async fn snapshot(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    /// Execute a command (IK motion, FK set joints, etc.).
    pub async fn execute(&self, cmd: Command) -> Result<RuntimeSnapshot, RuntimeError> {
        let ik_result = {
            let mut runtime = self.runtime.write().await;
            cmd.execute(&mut *runtime)?
        };
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, ik_result))
    }

    pub async fn solve_ik(
        &self,
        frame: FrameId,
        goal: IKGoal,
    ) -> Result<(Vec<f64>, IKResult), RuntimeError> {
        let runtime = self.runtime.read().await;
        let fk = ForwardKinematics::new(runtime.active_robot.chain.clone());
        let solver = DampedLeastSquaresSolver::new(fk, frame, IK_MAX_ITERS, IK_TOLERANCE, IK_LAMBDA);
        let q0 = runtime.active_robot.joints.clone();
        let result = solver.solve(&q0, goal);
        Ok((result.q.clone(), result))
    }

    // ── Program management ──

    /// Compile and store a motion program for preview.
    pub async fn schedule_program(&self, compiled: CompiledPlan) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().await;
            runtime.schedule_plan(compiled);
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    // ── Execution control (delegates to controller via BackendManager) ──

    /// Extract waypoints from the active plan's trajectory.
    fn trajectory_to_waypoints(runtime: &SceneRuntime) -> (Vec<Vec<f64>>, f64) {
        if let Some(ref plan) = runtime.scheduled_plan {
            let traj = &plan.merged_trajectory;
            let wps: Vec<Vec<f64>> = traj.waypoints().iter().map(|w| w.joints().to_vec()).collect();
            return (wps, traj.duration());
        }
        if let Some(ref plan) = runtime.active_plan {
            let traj = &plan.trajectory;
            let wps: Vec<Vec<f64>> = traj.waypoints().iter().map(|w| w.joints().to_vec()).collect();
            return (wps, traj.duration());
        }
        (Vec::new(), 0.0)
    }

    pub async fn start_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            let (waypoints, duration) = {
                let runtime = self.runtime.read().await;
                Self::trajectory_to_waypoints(&runtime)
            };
            if !waypoints.is_empty() && duration > 0.0 {
                let mut c = ctrl.write().await;
                c.execute(waypoints, duration).await?;
            }
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn pause_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            let mut c = ctrl.write().await;
            c.pause().await?;
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn resume_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            let mut c = ctrl.write().await;
            c.resume().await?;
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn cancel_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            let mut c = ctrl.write().await;
            c.stop().await?;
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn reset_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        // Reset the controller and plan for re-execution
        if let Some(ctrl) = self.manager.get_controller().await {
            let (waypoints, duration) = {
                let runtime = self.runtime.read().await;
                Self::trajectory_to_waypoints(&runtime)
            };
            if !waypoints.is_empty() && duration > 0.0 {
                let mut c = ctrl.write().await;
                c.execute(waypoints, duration).await?;
            }
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    // ── Tick ──

    /// Advance execution by `dt` seconds via the controller, then build
    /// a TickDelta from the resulting RobotState.
    pub async fn tick_execution_delta(&self, dt: f64) -> Result<TickDelta, RuntimeError> {
        // 1. Advance simulation time via the controller trait
        if let Some(ctrl) = self.manager.get_controller().await {
            let ctrl_guard = ctrl.read().await;
            let _ = ctrl_guard.advance(dt).await; // non-fatal for real backends
        }

        // 2. Read state back & update runtime joints
        if let Some(ctrl) = self.manager.get_controller().await {
            let state = ctrl.read().await.robot_state().await;
            let mut runtime = self.runtime.write().await;
            runtime.set_joints_from_state(&state.joints.positions);

            let plan_duration = runtime
                .active_plan
                .as_ref()
                .map(|p| p.trajectory.duration())
                .unwrap_or(0.0);

            let fk_result = Self::compute_fk(&runtime.active_robot.chain, &runtime.active_robot.joints);

            return Ok(TickDelta::from_robot_state(
                &state,
                runtime.active_robot.chain.clone(),
                fk_result,
                plan_duration,
                runtime.active_tcp.clone(),
            ));
        }

        // Fallback: no controller — read-only snapshot
        let runtime = self.runtime.read().await;
        let fk_result = Self::compute_fk(&runtime.active_robot.chain, &runtime.active_robot.joints);
        Ok(TickDelta {
            joints: runtime.active_robot.joints.clone(),
            chain: runtime.active_robot.chain.clone(),
            fk_result,
            execution: None,
            plan_duration: 0.0,
            active_tcp: runtime.active_tcp.clone(),
        })
    }
}
