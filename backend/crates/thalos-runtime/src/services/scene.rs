use std::sync::Arc;

use tokio::sync::RwLock;

use thalos_core::{
    execution::runtime::RuntimeProgram,
    kinematics::{
        forward::{ForwardKinematics, result::FKResult},
        inverse::{DampedLeastSquaresSolver, IKGoal, IKSolver, result::IKResult},
    },
    models::{RobotModel, RobotRegistry},
    robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};
use thalos_planning::motion::program::CompiledPlan;

use crate::backends::RobotBackend;
use crate::backends::controller::RobotController;
use crate::backends::controller::simulation::SimulationController;
use crate::backends::manager::BackendManager;
use crate::commands::Command;
use crate::commands::handler::ExecutableCommand;
use crate::error::RuntimeError;
use crate::motion_recorder::MotionRecorder;
use crate::motion_trace::MotionTrace;
use crate::plan::{PlanState, SessionStatus};
use crate::session::{ExecutionSource, SessionManager};
use crate::snapshots::{RuntimeSnapshot, TickDelta};
use crate::state::robot::{ActiveRobot, SceneRuntime};
use crate::telemetry::{ExecutionObserver, ExecutionRecorder, TraceMetadata};

use std::time::Duration;

/// Estado de grabación de una ejecución en curso.
struct RecordingState {
    session_id: u64,
    recorder: MotionRecorder,
    execution_recorder: ExecutionRecorder,
    start_time: Duration,
}

/// Derive an ExecutionSession from a RobotState.
const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

fn session_from_state(
    state: &Arc<crate::state::robot_state::RobotState>,
) -> Option<crate::plan::ExecutionSession> {
    use crate::state::robot_state::MotionMode;
    let progress = state.execution.progress;
    let status = match state.motion.mode {
        MotionMode::Idle if progress >= 1.0 => SessionStatus::Completed,
        MotionMode::Moving => SessionStatus::Running,
        MotionMode::Paused => SessionStatus::Paused,
        MotionMode::Stopping => SessionStatus::Cancelled,
        MotionMode::EStop => SessionStatus::Failed,
        _ => SessionStatus::Ready,
    };
    Some(crate::plan::ExecutionSession::derived(status, progress))
}

pub struct SceneService {
    runtime: RwLock<SceneRuntime>,
    backend: Box<dyn RobotBackend + Send + Sync>,
    manager: Arc<BackendManager>,
    sessions: Arc<SessionManager>,
    recording: RwLock<Option<RecordingState>>,
}

impl SceneService {
    pub fn new(
        backend: Box<dyn RobotBackend + Send + Sync>,
        manager: Arc<BackendManager>,
        model: RobotModel,
    ) -> Self {
        Self::with_session_manager(backend, manager, model, Arc::new(SessionManager::new()))
    }

    pub fn with_session_manager(
        backend: Box<dyn RobotBackend + Send + Sync>,
        manager: Arc<BackendManager>,
        model: RobotModel,
        sessions: Arc<SessionManager>,
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
            sessions,
            recording: RwLock::new(None),
        }
    }

    fn compute_fk(chain: &SerialChain, joints: &[f64]) -> FKResult {
        let fk = ForwardKinematics::new(chain.clone());
        fk.evaluate(joints)
    }

    fn build_snapshot(runtime: &SceneRuntime, ik_result: Option<IKResult>) -> RuntimeSnapshot {
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

    /// Build a snapshot that includes execution state from the controller.
    ///
    /// Reads the controller's RobotState and derives ExecutionSession + joints.
    async fn build_snapshot_with_execution(
        runtime: &tokio::sync::RwLock<SceneRuntime>,
        controller: &Arc<RwLock<dyn RobotController + Send + Sync>>,
    ) -> RuntimeSnapshot {
        let ctrl = controller.read().await;
        let state = ctrl.robot_state().await;
        let mut rt = runtime.write().await;
        rt.set_joints_from_state(&state.joints.positions);

        let fk_result = Self::compute_fk(&rt.active_robot.chain, &rt.active_robot.joints);
        let execution = session_from_state(&state);

        // Sync the active_plan state with the execution
        if let Some(ref mut plan) = rt.active_plan {
            if let Some(ref exe) = execution {
                match exe.status {
                    SessionStatus::Running => plan.state = PlanState::Active,
                    SessionStatus::Paused => plan.state = PlanState::Paused,
                    SessionStatus::Completed => plan.state = PlanState::Completed,
                    SessionStatus::Cancelled => plan.state = PlanState::Cancelled,
                    SessionStatus::Failed => plan.state = PlanState::Failed,
                    SessionStatus::Ready => {}
                }
            }
        }

        RuntimeSnapshot {
            robot: rt.active_robot.model,
            robot_source: rt.robot_source.clone(),
            robot_name: rt.robot_name.clone(),
            joints_meta: rt.joints_meta.clone(),
            joints: rt.active_robot.joints.clone(),
            chain: rt.active_robot.chain.clone(),
            fk_result,
            ik_result: None,
            active_plan: rt.active_plan.clone(),
            execution,
            active_tcp: rt.active_tcp.clone(),
            generated_at: chrono::Utc::now(),
        }
    }

    /// Read-only snapshot (no IK metadata).
    pub async fn snapshot(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    /// The active robot model of the scene.
    ///
    /// The semantic planning path injects this model into the
    /// `MotionResolver` boundary (invariant I1 — single robot per
    /// compilation, taken from scene state).
    pub async fn robot_model(&self) -> RobotModel {
        let runtime = self.runtime.read().await;
        runtime.active_robot.model
    }

    /// The current joint configuration of the scene's active robot.
    ///
    /// Used as the resolver's `initial_state` so planning starts from the
    /// scene's real configuration, never a hardcoded zero vector (I3).
    pub async fn initial_joints(&self) -> Vec<f64> {
        let runtime = self.runtime.read().await;
        runtime.active_robot.joints.clone()
    }

    /// Execute a command (IK motion, FK set joints, etc.).
    pub async fn execute(&self, cmd: Command) -> Result<RuntimeSnapshot, RuntimeError> {
        let is_robot_change = matches!(cmd, Command::LoadRobot(_) | Command::LoadUrdfRobot { .. });

        let ik_result = {
            let mut runtime = self.runtime.write().await;
            cmd.execute(&mut *runtime)?
        };

        // If the robot changed, update the SimulationController with the new DOF
        if is_robot_change {
            let dof = {
                let rt = self.runtime.read().await;
                rt.active_robot.chain.dof_count()
            };
            let new_ctrl = Arc::new(RwLock::new(SimulationController::new(dof)))
                as Arc<RwLock<dyn RobotController + Send + Sync>>;
            // Silently replace — the manager handles disconnection
            let _ = self.manager.replace_controller(new_ctrl).await;
        }

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
        let solver =
            DampedLeastSquaresSolver::new(fk, frame, IK_MAX_ITERS, IK_TOLERANCE, IK_LAMBDA);
        let q0 = runtime.active_robot.joints.clone();
        let result = solver.solve(&q0, goal)?;
        Ok((result.q.clone(), result))
    }

    // ── Program management ──

    /// Compile and store a motion program for preview.
    ///
    /// Accepts the `RuntimeProgram` (absolute `at_time` events) alongside the
    /// `CompiledPlan` (PR 3): the compiled trajectory is stored for preview
    /// and the event program is loaded into the controller so the tick loop
    /// dispatches `SetOutput`/`Delay` at their absolute times.
    pub async fn schedule_program(
        &self,
        compiled: CompiledPlan,
        runtime: RuntimeProgram,
    ) -> Result<RuntimeSnapshot, RuntimeError> {
        {
            let mut runtime = self.runtime.write().await;
            runtime.schedule_plan(compiled);
        }
        // Hand the event timeline to the controller (no-op for backends
        // that do not dispatch runtime events).
        if let Some(ctrl) = self.manager.get_controller().await {
            let mut c = ctrl.write().await;
            c.load_runtime_program(runtime).await?;
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    // ── Execution control (delegates to controller via BackendManager) ──

    /// Extract waypoints from the active plan's trajectory.
    fn trajectory_to_waypoints(runtime: &SceneRuntime) -> (Vec<Vec<f64>>, f64) {
        if let Some(ref plan) = runtime.scheduled_plan {
            let traj = &plan.merged_trajectory;
            let wps: Vec<Vec<f64>> = traj
                .waypoints()
                .iter()
                .map(|w| w.joints().to_vec())
                .collect();
            return (wps, traj.duration());
        }
        if let Some(ref plan) = runtime.active_plan {
            let traj = &plan.trajectory;
            let wps: Vec<Vec<f64>> = traj
                .waypoints()
                .iter()
                .map(|w| w.joints().to_vec())
                .collect();
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

            // Execute on controller FIRST (before creating session).
            // If execution fails, no orphaned session is created.
            let has_wps = !waypoints.is_empty() && duration > 0.0;
            if has_wps {
                let wps_exec = waypoints.clone();
                let mut c = ctrl.write().await;
                c.execute(wps_exec, duration).await?;
            }

            // Only now register the session — execution already started.
            let robot_name = {
                let runtime = self.runtime.read().await;
                runtime.robot_name.clone()
            };
            let source = ExecutionSource::Simulation;
            let wps_for_recorder = waypoints.clone();
            let joint_count = wps_for_recorder.first().map(|w| w.len()).unwrap_or(0);
            let robot_name_for_session = robot_name.clone();
            let session = self
                .sessions
                .register(
                    source.clone(),
                    "plan-exec".into(),
                    duration,
                    joint_count,
                    robot_name_for_session,
                )
                .await;

            let mut recorder = MotionRecorder::new();
            if !wps_for_recorder.is_empty() {
                recorder.set_target_waypoints(wps_for_recorder);
            }
            recorder.start(std::time::Duration::from_secs_f64(duration));

            let exec_metadata = TraceMetadata {
                session_id: session.id.to_string(),
                plan_id: session.plan_id.clone(),
                source: source,
                robot_name: robot_name.clone(),
                joint_count,
                duration: std::time::Duration::from_secs_f64(duration),
                sample_rate: 0.0,
            };
            let mut exec_recorder = ExecutionRecorder::new(exec_metadata);
            let ts = std::time::Duration::ZERO;
            ExecutionObserver::on_execution_started(&mut exec_recorder, ts);

            *self.recording.write().await = Some(RecordingState {
                session_id: session.id,
                recorder,
                execution_recorder: exec_recorder,
                start_time: std::time::Duration::ZERO,
            });

            return Ok(Self::build_snapshot_with_execution(&self.runtime, &ctrl).await);
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    /// Seek the active controller to a position (fraction 0.0–1.0).
    ///
    /// Only meaningful for replay/simulation backends.
    pub async fn seek_execution(&self, position: f64) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            let ctrl_guard = ctrl.read().await;
            ctrl_guard
                .seek(position)
                .await
                .map_err(|e| RuntimeError::JointCountMismatch {
                    expected: 0,
                    received: 0,
                })?;
            drop(ctrl_guard);
            return Ok(Self::build_snapshot_with_execution(&self.runtime, &ctrl).await);
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn pause_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            {
                let mut c = ctrl.write().await;
                c.pause().await?;
            } // write lock dropped
            return Ok(Self::build_snapshot_with_execution(&self.runtime, &ctrl).await);
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn resume_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            {
                let mut c = ctrl.write().await;
                c.resume().await?;
            } // write lock dropped
            return Ok(Self::build_snapshot_with_execution(&self.runtime, &ctrl).await);
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn cancel_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        if let Some(ctrl) = self.manager.get_controller().await {
            {
                let mut c = ctrl.write().await;
                c.stop().await?;
            }
            // Finalize recording as Cancelled if active
            self.finalize_recording(Some(crate::plan::SessionStatus::Cancelled))
                .await;
            return Ok(Self::build_snapshot_with_execution(&self.runtime, &ctrl).await);
        }
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    pub async fn reset_execution(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        // Finalize any active recording as Cancelled first
        self.finalize_recording(Some(crate::plan::SessionStatus::Cancelled))
            .await;

        // Reset the plan state to Created (without starting execution)
        {
            let mut runtime = self.runtime.write().await;
            if let Some(ref mut plan) = runtime.active_plan {
                plan.state = crate::plan::PlanState::Created;
                plan.started_at = None;
                plan.completed_at = None;
            }
        }

        // Read-only snapshot (no controller execution)
        let runtime = self.runtime.read().await;
        Ok(Self::build_snapshot(&runtime, None))
    }

    /// Finalizar la grabación activa (si existe) y guardar el trace.
    ///
    /// Si `terminal_status` es `Some`, usa ese estado en vez de `Completed`.
    /// Por defecto (`None`), usa `Completed`.
    async fn finalize_recording(&self, terminal_status: Option<crate::plan::SessionStatus>) {
        let mut recording = self.recording.write().await;
        if let Some(mut rec) = recording.take() {
            let trace = rec.recorder.stop();
            let ts = std::time::Duration::ZERO;
            rec.execution_recorder.on_execution_finished(ts);
            let exec_trace = rec.execution_recorder.trace();
            let status = terminal_status.unwrap_or(crate::plan::SessionStatus::Completed);
            let _ = self
                .sessions
                .complete_with_status(rec.session_id, trace, status)
                .await;
            if let Some(et) = exec_trace {
                self.sessions.save_execution_trace(rec.session_id, et).await;
            }
        }
    }

    // ── Tick ──

    /// Advance execution by `dt` seconds via the controller, then build
    /// a TickDelta from the resulting RobotState.
    ///
    /// Also records the state into the active MotionRecorder if recording
    /// is in progress, and finalizes the session when execution completes.
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

            // 3. Record the current state if recording
            let mut recording = self.recording.write().await;
            if let Some(ref mut rec_state) = *recording {
                let timestamp = {
                    let elapsed = rec_state.start_time
                        + std::time::Duration::from_secs_f64(
                            state.execution.progress * plan_duration.max(1.0),
                        );
                    elapsed
                };
                rec_state.recorder.record(timestamp, &state);
                rec_state.execution_recorder.on_sample(timestamp, &state);

                // Check if execution completed — finalize recording
                if state.execution.progress >= 1.0
                    || matches!(
                        state.motion.mode,
                        crate::state::robot_state::MotionMode::Idle
                    )
                {
                    let trace = rec_state.recorder.stop();
                    rec_state
                        .execution_recorder
                        .on_execution_finished(timestamp);
                    let exec_trace = rec_state.execution_recorder.trace();
                    self.sessions.complete(rec_state.session_id, trace).await;
                    if let Some(et) = exec_trace {
                        self.sessions
                            .save_execution_trace(rec_state.session_id, et)
                            .await;
                    }
                    *recording = None;
                }
            }
            drop(recording);

            let fk_result =
                Self::compute_fk(&runtime.active_robot.chain, &runtime.active_robot.joints);

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
