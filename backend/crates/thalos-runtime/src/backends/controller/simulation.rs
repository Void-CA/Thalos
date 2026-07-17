use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use arc_swap::ArcSwap;
use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::backends::controller::{BackendCapabilities, RobotController};
use crate::error::ControllerError;
use crate::plan::{ExecutionSession, SessionStatus};
use crate::state::robot_state::{
    Diagnostics, ExecutionState, JointState, MotionMode, MotionState,
    RobotState,
};

/// Simulation backend — the default controller when no hardware is connected.
///
/// Advances trajectories by interpolating waypoints linearly against
/// an internal clock. Publishes an `ArcSwap<RobotState>` that readers
/// can load cheaply without lock contention.
pub struct SimulationController {
    connected: AtomicBool,
    waypoints: RwLock<Vec<Vec<f64>>>,
    duration: RwLock<f64>,
    execution: RwLock<ExecutionSession>,
    dof: usize,
    state: ArcSwap<RobotState>,
}

impl SimulationController {
    pub fn new(dof: usize) -> Self {
        let initial = RobotState::default();
        Self {
            connected: AtomicBool::new(false),
            waypoints: RwLock::new(Vec::new()),
            duration: RwLock::new(0.0),
            execution: RwLock::new(ExecutionSession::new("sim")),
            dof,
            state: ArcSwap::new(Arc::new(initial)),
        }
    }

    /// Reinitialize the controller for a different robot DOF.
    ///
    /// Called when the user loads a new robot (canonical or URDF).
    /// Preserves the connected state (if any), resets everything else.
    pub fn reconfigure(&mut self, dof: usize) {
        self.waypoints = RwLock::new(Vec::new());
        self.duration = RwLock::new(0.0);
        self.execution = RwLock::new(ExecutionSession::new("sim"));
        self.dof = dof;
        self.state.store(Arc::new(RobotState::default()));
    }

    /// Advance the simulation by `dt` seconds, interpolating joint angles
    /// and updating the internal `RobotState`.
    pub async fn advance_inner(&self, dt: f64) {
        let waypoints = self.waypoints.read().await;
        let duration = *self.duration.read().await;
        let mut execution = self.execution.write().await;

        if execution.status != SessionStatus::Running || execution.status.is_terminal() {
            return;
        }
        if waypoints.is_empty() || duration <= 0.0 {
            return;
        }

        let total_steps = waypoints.len().saturating_sub(1);
        if total_steps == 0 {
            return;
        }

        let progress = execution.advance(dt, duration);
        let frac = progress.clamp(0.0, 1.0);
        let idx_f = frac * total_steps as f64;
        let i = idx_f.floor() as usize;
        let j = (i + 1).min(waypoints.len() - 1);
        let local_frac = idx_f - i as f64;

        let joints: Vec<f64> = waypoints[i]
            .iter()
            .zip(&waypoints[j])
            .map(|(&a, &b)| a + (b - a) * local_frac)
            .collect();

        let new_revision = self.state.load().revision + 1;
        let new_state = RobotState {
            revision: new_revision,
            joints: JointState {
                positions: joints,
                velocities: vec![0.0; self.dof],
                torques: vec![0.0; self.dof],
            },
            execution: ExecutionState {
                current_program: None,
                current_segment: None,
                progress,
            },
            motion: MotionState {
                mode: if execution.status == SessionStatus::Completed {
                    MotionMode::Idle
                } else {
                    MotionMode::Moving
                },
                power_on: true,
                motion_enabled: true,
            },
            diagnostics: Diagnostics {
                timestamp: chrono::Utc::now(),
                ..Diagnostics::default()
            },
            ..RobotState::default()
        };

        self.state.store(Arc::new(new_state));
    }
}

#[async_trait]
impl RobotController for SimulationController {
    async fn connect(&mut self) -> Result<(), ControllerError> {
        if self.connected.swap(true, Ordering::SeqCst) {
            return Err(ControllerError::AlreadyConnected);
        }
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), ControllerError> {
        self.connected.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    async fn execute(
        &mut self,
        waypoints: Vec<Vec<f64>>,
        duration: f64,
    ) -> Result<(), ControllerError> {
        if !self.is_connected() {
            return Err(ControllerError::NotConnected);
        }
        if waypoints.is_empty() || duration <= 0.0 {
            return Ok(());
        }

        let initial_positions = waypoints.first().cloned().unwrap_or_default();
        *self.waypoints.write().await = waypoints;
        *self.duration.write().await = duration;

        let mut exec = self.execution.write().await;
        exec.reset();
        exec.start();

        // Update the shared state to reflect active execution
        let new_revision = self.state.load().revision + 1;
        let new_state = RobotState {
            revision: new_revision,
            joints: JointState {
                positions: initial_positions,
                velocities: vec![0.0; self.dof],
                torques: vec![0.0; self.dof],
            },
            execution: ExecutionState {
                current_program: None,
                current_segment: None,
                progress: 0.0,
            },
            motion: MotionState {
                mode: MotionMode::Moving,
                power_on: true,
                motion_enabled: true,
            },
            diagnostics: Diagnostics {
                timestamp: chrono::Utc::now(),
                ..Diagnostics::default()
            },
            ..RobotState::default()
        };
        self.state.store(Arc::new(new_state));

        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ControllerError> {
        self.execution.write().await.cancel();
        self.state.rcu(|prev| {
            let mut s = (**prev).clone();
            s.revision = prev.revision + 1;
            s.motion.mode = MotionMode::Idle;
            s.motion.motion_enabled = false;
            s.execution.progress = 1.0;
            Arc::new(s)
        });
        Ok(())
    }

    async fn pause(&mut self) -> Result<(), ControllerError> {
        self.execution.write().await.pause();
        self.state.rcu(|prev| {
            let mut s = (**prev).clone();
            s.revision = prev.revision + 1;
            s.motion.mode = MotionMode::Paused;
            Arc::new(s)
        });
        Ok(())
    }

    async fn resume(&mut self) -> Result<(), ControllerError> {
        self.execution.write().await.resume();
        self.state.rcu(|prev| {
            let mut s = (**prev).clone();
            s.revision = prev.revision + 1;
            s.motion.mode = MotionMode::Moving;
            Arc::new(s)
        });
        Ok(())
    }

    async fn advance(&self, dt: f64) -> Result<(), ControllerError> {
        self.advance_inner(dt).await;
        Ok(())
    }

    async fn robot_state(&self) -> Arc<RobotState> {
        self.state.load_full()
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities::full()
    }
}
