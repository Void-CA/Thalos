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
use thalos_planning::motion::program::{CompiledPlan, PlanningProgram};
use thalos_planning::program_edit::ProgramEdit;

use crate::backends::RobotBackend;
use crate::backends::controller::RobotController;
use crate::backends::controller::simulation::SimulationController;
use crate::backends::manager::BackendManager;
use crate::commands::Command;
use crate::commands::handler::ExecutableCommand;
use crate::error::RuntimeError;
use crate::execution_boundary::ExecutionSample as ProtocolSample;
use crate::motion_recorder::MotionRecorder;
use crate::motion_trace::MotionTrace;
use crate::plan::{PlanState, SessionStatus};
use crate::services::command_history::{AppliedCommand, CommandMetrics};
use crate::session::{ExecutionSource, SessionManager};
use crate::snapshots::{RuntimeSnapshot, TickDelta};
use crate::state::robot::{ActiveRobot, SceneRuntime};
use crate::telemetry::{
    ExecutionObserver, ExecutionRecorder, ExecutionSample as TelemetrySample, ExecutionTrace,
    TraceMetadata,
};

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
        let active_robot = ActiveRobot::new(Some(model), chain, vec![0.0; dof]);
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
            robot_id: runtime.robot_id.clone(),
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
        // R4-001: the derived session carries the ACTIVE controller's source so
        // the badge reports Hardware/Esp32 when the ESP32 backend is connected.
        let source = ctrl.execution_source();
        let execution = session_from_state(&state).map(|exe| exe.with_source(source));

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
            robot_id: rt.robot_id.clone(),
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

    // ── Scene write-back (PR4 — design-first, D4/D5) ──

    /// Toggle the scene-writeback feature flag (design D5).
    ///
    /// OFF by default. Enabling it is the per-environment rollout step after
    /// integration tests pass. Flipping it back OFF restores the read-only
    /// behavior with zero code changes.
    pub async fn set_scene_writeback(&self, enabled: bool) {
        let mut runtime = self.runtime.write().await;
        runtime.set_scene_writeback(enabled);
    }

    /// Configure the command-history capacity (spec command-endpoints
    /// "History Cap"). Honors the optional `THALOS_HISTORY_CAP` env var read
    /// at the binary entry point; defaults to [`DEFAULT_HISTORY_CAP`].
    pub async fn set_history_cap(&self, cap: usize) {
        let mut runtime = self.runtime.write().await;
        runtime.with_history_cap(cap);
    }

    /// Apply a recompiled plan back to the runtime (design D4).
    ///
    /// Write-back path for `POST /plan/commands/apply`:
    /// 1. `SceneRuntime::replace_active_plan` — feature-flagged, snapshot +
    ///    atomic restore on failure.
    /// 2. On success, the applied command, its pre-computed inverse and the
    ///    plan metrics are recorded (D6) so PR5's `undo` can pop it in O(1)
    ///    and report the restored health without re-analysis.
    /// 3. `applied_program` links the entry to the program the apply wrote
    ///    back (R4-001) — undo refuses a stale inverse.
    ///
    /// `trajectory_to_waypoints` reads `scheduled_plan` first, so the new
    /// plan propagates to execution automatically.
    pub async fn apply_compiled_plan(
        &self,
        compiled: CompiledPlan,
        command: ProgramEdit,
        inverse: ProgramEdit,
        metrics: CommandMetrics,
        applied_program: Vec<thalos_core::motion::segment::MotionSegment>,
    ) -> Result<RuntimeSnapshot, RuntimeError> {
        let mut runtime = self.runtime.write().await;
        runtime.replace_active_plan(compiled)?;
        runtime.record_applied_command(command, inverse, metrics, applied_program);
        Ok(Self::build_snapshot(&runtime, None))
    }

    /// Number of applied commands with stored inverses (undo history size).
    pub async fn history_len(&self) -> usize {
        let runtime = self.runtime.read().await;
        runtime.history_len()
    }

    /// Peek the last applied command together with the history version (PR2).
    ///
    /// The `(entry, version)` pair is read under a SINGLE read lock — the undo
    /// flow recompiles against `entry` and later commits with `version` as the
    /// expected value, closing the TOCTOU window between peek and commit.
    pub async fn last_applied_with_version(&self) -> (Option<AppliedCommand>, u64) {
        let runtime = self.runtime.read().await;
        let (entry, version) = runtime.last_applied_with_version();
        (entry.cloned(), version)
    }

    /// Undo the last applied command (design D6): pop (O(1)) + write back the
    /// recompiled inverse-applied plan WITHOUT recording a new entry.
    ///
    /// Atomic and feature-flagged via `SceneRuntime::undo_plan` (D4/D5). The
    /// R4-001 stale guard lives in the runtime: `current_program` is the
    /// program reconstructed from the active plan and must match the entry's
    /// `applied_program`, else `StaleUndo` — no mutation, history intact.
    /// PR2: `expected_version` is the history version read atomically with the
    /// last entry (`last_applied_with_version`); the runtime re-validates it
    /// under the write lock BEFORE any mutation (`UndoVersionMismatch`).
    /// The popped entry is returned so the API can report the restored
    /// metrics; the snapshot carries the restored active plan.
    pub async fn undo_compiled_plan(
        &self,
        current_program: &PlanningProgram,
        compiled: CompiledPlan,
        expected_version: u64,
    ) -> Result<(AppliedCommand, RuntimeSnapshot), RuntimeError> {
        let mut runtime = self.runtime.write().await;
        let popped = runtime.undo_plan(current_program, compiled, expected_version)?;
        Ok((popped, Self::build_snapshot(&runtime, None)))
    }

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
        // R3-001: with NO active controller (e.g. the hardware backend is
        // active but was never connected, or the device was disconnected while
        // active) start must fail EXPLICITLY with `not_connected` — a silent
        // 200 made the frontend report 'running' until the first tick dropped
        // it to 'idle' with no error and no CTA.
        let ctrl = self
            .manager
            .get_controller()
            .await
            .ok_or_else(|| RuntimeError::ControllerFailed {
                source: crate::error::ControllerError::NotConnected,
            })?;
        {
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
            // R4-001: the source reflects the ACTIVE controller (Simulation vs
            // Hardware/Esp32), not a hardcoded value — the badge must be able to
            // say Hardware when the ESP32 backend is connected.
            let source = self.manager.active_source().await;
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
        }

        Ok(Self::build_snapshot_with_execution(&self.runtime, &ctrl).await)
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
                .map_err(|e| RuntimeError::ControllerFailed { source: e })?;
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

    /// Assemble a telemetry [`ExecutionTrace`] from raw protocol samples
    /// (`execution_boundary::ExecutionSample`), as required by the pinned
    /// trace-storage decision: telemetry samples carry `timestamp` from µs,
    /// empty velocities/accelerations, zeroed TCP, and
    /// `progress = seconds / plan_duration`.
    fn assemble_execution_trace(
        samples: &[ProtocolSample],
        plan_duration: f64,
        session_id: u64,
        plan_id: String,
        robot_name: String,
    ) -> ExecutionTrace {
        let joint_count = samples.first().map(|s| s.joints.len()).unwrap_or(0);
        let metadata = TraceMetadata {
            session_id: session_id.to_string(),
            plan_id,
            source: ExecutionSource::Hardware,
            robot_name,
            joint_count,
            duration: std::time::Duration::from_secs_f64(plan_duration),
            sample_rate: 0.0,
        };
        let mut trace = ExecutionTrace::new(metadata);
        let duration = plan_duration.max(1.0);
        for s in samples {
            let seconds = s.timestamp_us as f64 / 1_000_000.0;
            trace.push_sample(TelemetrySample {
                timestamp: std::time::Duration::from_micros(s.timestamp_us),
                joints: s.joints.clone(),
                velocities: vec![],
                accelerations: vec![],
                tcp_pose: [0.0; 7],
                tcp_velocity: [0.0; 6],
                tracking_error: None,
                progress: seconds / duration,
            });
        }
        trace
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
        // 1. Advance simulation time via the controller trait.
        // R4-001: a real failure (e.g. `ConnectionLost`) from `advance` must
        // PROPAGATE as an execution failure — not be swallowed — so the code
        // reaches the frontend and the session can be marked failed. The only
        // ignorable case is `UnsupportedCapability`: real hardware backends
        // implement `advance` as the default `Err(UnsupportedCapability)` — time
        // is real, the tick reads state back below.
        if let Some(ctrl) = self.manager.get_controller().await {
            let ctrl_guard = ctrl.read().await;
            if let Err(e) = ctrl_guard.advance(dt).await {
                if !matches!(e, crate::error::ControllerError::UnsupportedCapability) {
                    return Err(RuntimeError::ControllerFailed { source: e });
                }
            }
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

            // Active source determines progress UNITS (S3.6 / RISK-1):
            // hardware backends populate `execution.progress` in SECONDS
            // (esp32 map_firmware_state: fraction × plan_duration); simulation
            // keeps a 0..1 fraction.
            let active_source = self.manager.active_source().await;

            // Hoisted completion detection — evaluated on EVERY tick, outside
            // the recording gate, so the hardware execution trace is drained
            // and saved even when recording is not active (S3.6).
            //
            // RISK-1 / REL-01: for Hardware the gate compares SECONDS against
            // the active plan's duration (`>= plan_duration.max(1.0)`) — the
            // old fraction threshold (`>= 1.0`) finalized mid-run on any plan
            // > 1s and dropped the trace at true completion. Simulation keeps
            // the historical fraction/Idle gate.
            //
            // REL-03 / RES-06: EStop is a TERMINAL condition — it must
            // finalize the session (as Failed), never leave it Running.
            let estop = matches!(
                state.motion.mode,
                crate::state::robot_state::MotionMode::EStop
            );
            let completed = estop
                || match active_source {
                    ExecutionSource::Hardware => {
                        state.execution.progress >= plan_duration.max(1.0)
                    }
                    _ => {
                        state.execution.progress >= 1.0
                            || matches!(
                                state.motion.mode,
                                crate::state::robot_state::MotionMode::Idle
                            )
                    }
                };

            // Backend-conditional recording timestamp (S3.6).
            let progress_in_seconds = match active_source {
                ExecutionSource::Hardware => state.execution.progress,
                _ => state.execution.progress * plan_duration.max(1.0),
            };

            let mut completed_session_id: Option<u64> = None;
            {
                // 3. Record the current state if recording
                let mut recording = self.recording.write().await;
                if let Some(ref mut rec_state) = *recording {
                    completed_session_id = Some(rec_state.session_id);
                    let timestamp = {
                        let elapsed = rec_state.start_time
                            + std::time::Duration::from_secs_f64(progress_in_seconds);
                        elapsed
                    };
                    rec_state.recorder.record(timestamp, &state);
                    rec_state.execution_recorder.on_sample(timestamp, &state);

                    // Check if execution completed — finalize recording.
                    // REL-03 / RES-06: EStop finalizes as FAILED, not
                    // Completed — a stopped-by-error run must not report done.
                    if completed {
                        let trace = rec_state.recorder.stop();
                        rec_state
                            .execution_recorder
                            .on_execution_finished(timestamp);
                        let exec_trace = rec_state.execution_recorder.trace();
                        let status = if estop {
                            SessionStatus::Failed
                        } else {
                            SessionStatus::Completed
                        };
                        self.sessions
                            .complete_with_status(rec_state.session_id, trace, status)
                            .await;
                        if let Some(et) = exec_trace {
                            self.sessions
                                .save_execution_trace(rec_state.session_id, et)
                                .await;
                        }
                        *recording = None;
                    }
                }
            }

            // 3b. Unconditional drain (S3.6): on a completed tick, take the
            //     hardware execution trace (if any) and persist it as a
            //     telemetry `ExecutionTrace` — runs even when recording was
            //     already finalized on an earlier tick.
            if completed {
                if let Some(samples) = ctrl.read().await.take_execution_trace().await {
                    if !samples.is_empty() {
                        if let Some(session_id) = completed_session_id {
                            let robot_name = runtime.robot_name.clone();
                            let plan_id = runtime
                                .active_plan
                                .as_ref()
                                .map(|p| p.plan_id.clone())
                                .unwrap_or_default();
                            let trace = Self::assemble_execution_trace(
                                &samples,
                                plan_duration,
                                session_id,
                                plan_id,
                                robot_name,
                            );
                            self.sessions.save_execution_trace(session_id, trace).await;
                        }
                    }
                }
            }

            let fk_result =
                Self::compute_fk(&runtime.active_robot.chain, &runtime.active_robot.joints);

            let mut delta = TickDelta::from_robot_state(
                &state,
                runtime.active_robot.chain.clone(),
                fk_result,
                plan_duration,
                runtime.active_tcp.clone(),
            );
            // R4-001: tick deltas carry the ACTIVE controller's source so the
            // running badge keeps reflecting the real backend (Hardware/Esp32).
            if let Some(ref exe) = delta.execution {
                delta.execution = Some(exe.clone().with_source(active_source));
            }
            return Ok(delta);
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

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_planning::motion::program::CompiledPlan;

    /// A VALID compiled plan: two waypoints, non-zero duration, target `[t, t]`.
    fn compiled_plan(t: f64) -> CompiledPlan {
        let points = vec![
            thalos_core::trajectory::TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            thalos_core::trajectory::TrajectoryPoint::new(vec![t, t], 1.0),
        ];
        CompiledPlan::new(thalos_core::trajectory::Trajectory::new(points), vec![])
    }

    /// A MoveWaypoint edit — the shape the apply pipeline records.
    fn recorded_edit() -> (ProgramEdit, ProgramEdit) {
        let cmd = ProgramEdit::MoveWaypoint {
            segment_index: 0,
            new_target: vec![2.0, 2.0],
            old_target: Some(vec![1.0, 1.0]),
        };
        (cmd.clone(), cmd.inverse())
    }

    #[tokio::test]
    async fn reset_execution_preserves_command_history() {
        // Spec command-endpoints "Reset execution preserves history": resetting
        // execution must NOT clear the applied-command history — the program is
        // intact, so undo from a reset state stays valid.
        let manager = Arc::new(BackendManager::new());
        let service = SceneService::with_session_manager(
            Box::new(crate::backends::InternalBackend),
            manager,
            RobotModel::Planar2R,
            Arc::new(SessionManager::new()),
        );
        service.set_scene_writeback(true).await;

        // Seed the history with one applied command (feature-flagged apply).
        let (cmd, inverse) = recorded_edit();
        service
            .apply_compiled_plan(
                compiled_plan(1.0),
                cmd,
                inverse,
                CommandMetrics::new(0.4, 0.6),
                Vec::new(),
            )
            .await
            .expect("apply must succeed with the write-back flag on");
        assert_eq!(service.history_len().await, 1, "setup: one applied command");

        service
            .reset_execution()
            .await
            .expect("reset_execution must succeed");

        assert_eq!(
            service.history_len().await,
            1,
            "reset_execution must NOT clear command history (undo stays valid)"
        );
    }
}
