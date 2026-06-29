use thalos_core::{kinematics::{
    forward::ForwardKinematics,
    inverse::{DampedLeastSquaresSolver, IKGoal, IKResult, IKSolver},
}, prelude::Trajectory};
use thalos_core::spatial::frame::FrameId;
use thalos_models::Robot;
use thalos_planning::motion::program::CompiledPlan;

pub use thalos_core::prelude::ActiveRobot;
use crate::snapshots::scene::JointMeta;

use crate::plan::{ActiveMotionPlan, ExecutionSession, MotionType, PlanState, SessionStatus};

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
    pub robot_name: String,
    /// Original URDF model — `None` for built-in robots, `Some` for imports.
    pub robot_source: Option<Robot>,
    pub joints_meta: Vec<JointMeta>,

    /// The compiled plan ready for visualisation and execution.
    /// Set by Preview — immutable, carries trajectory + segments.
    /// The frontend renders from this; ExecutionSession advances through it.
    pub scheduled_plan: Option<CompiledPlan>,

    /// Active plan for snapshot backward compatibility.
    /// Set directly by single-shot commands (MoveJ/MoveL), or derived
    /// from `scheduled_plan` when a multi-segment program is compiled.
    pub active_plan: Option<ActiveMotionPlan>,

    /// Current execution session, if the user has pressed Start.
    pub execution: Option<ExecutionSession>,

    next_plan_id: u64,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot, robot_name: String) -> Self {
        Self {
            active_robot,
            robot_name,
            robot_source: None,
            joints_meta: Vec::new(),
            scheduled_plan: None,
            active_plan: None,
            execution: None,
            next_plan_id: 0,
        }
    }

    pub fn solve_and_apply_ik(&mut self, frame: FrameId, goal: IKGoal) -> IKResult {
        let fk = ForwardKinematics::new(self.active_robot.chain.clone());
        let solver =
            DampedLeastSquaresSolver::new(fk, frame, IK_MAX_ITERS, IK_TOLERANCE, IK_LAMBDA);
        let q0 = self.active_robot.joints.clone();
        let result = solver.solve(&q0, goal);
        self.active_robot.joints = result.q.clone();
        result
    }

    // ── Single-shot plan setters (MoveJ / MoveL) ──

    pub fn set_completed_plan(&mut self, trajectory: impl Into<Trajectory>, motion_type: MotionType) {
        let tid = self.next_plan_id();
        self.active_plan = Some(ActiveMotionPlan::completed(tid, trajectory.into(), motion_type));
    }

    pub fn set_created_plan(&mut self, trajectory: impl Into<Trajectory>, motion_type: MotionType) {
        let tid = self.next_plan_id();
        self.active_plan = Some(ActiveMotionPlan::created(tid, trajectory.into(), motion_type));
    }

    // ── Multi-segment program (Preview / Execution) ──

    /// Schedule a compiled multi-segment program for preview and optional execution.
    ///
    /// Stores the compiled plan for visualisation and clears any previous
    /// execution. The robot does NOT move — this is the "Preview" action.
    pub fn schedule_plan(&mut self, compiled: CompiledPlan) {
        let tid = self.next_plan_id();
        self.scheduled_plan = Some(compiled.clone());
        self.active_plan = Some(ActiveMotionPlan::from_compiled_plan(tid, compiled));
        self.execution = None;
    }

    /// Start execution — creates an ExecutionSession in Running state.
    /// Returns true if execution started, false if no plan is scheduled.
    pub fn start_execution(&mut self) -> bool {
        let plan_id = match self.active_plan.as_ref() {
            Some(p) => p.plan_id.clone(),
            None => return false,
        };
        let mut session = ExecutionSession::new(plan_id);
        session.start();
        self.execution = Some(session);
        true
    }

    pub fn pause_execution(&mut self) {
        if let Some(ref mut exe) = self.execution {
            exe.pause();
        }
    }

    pub fn resume_execution(&mut self) {
        if let Some(ref mut exe) = self.execution {
            exe.resume();
        }
    }

    pub fn cancel_execution(&mut self) {
        if let Some(ref mut exe) = self.execution {
            exe.cancel();
        }
    }

    /// Reset the execution session so the plan can be re-run.
    pub fn reset_execution(&mut self) {
        match self.execution {
            Some(ref mut exe) => exe.reset(),
            None => {
                if let Some(ref p) = self.active_plan {
                    self.execution = Some(ExecutionSession::new(p.plan_id.clone()));
                }
            }
        }
    }

    pub fn clear_plan(&mut self) {
        self.scheduled_plan = None;
        self.active_plan = None;
        self.execution = None;
    }

    /// Advance execution by `dt` seconds, interpolating robot joints along
    /// the trajectory.
    ///
    /// Returns `true` while the execution is still running (not terminal).
    ///
    /// # Borrow checker strategy
    ///
    /// Snapshot the trajectory waypoints into a local Vec before mutating
    /// `self.execution` or `self.active_robot`. Trajectories are small
    /// (tens of waypoints) so cloning joint vectors is negligible.
    pub fn advance_trajectory(&mut self, dt: f64) -> bool {
        // Phase 1 — immutable: check if we can advance
        let running = match self.execution.as_ref() {
            Some(exe) => exe.status == SessionStatus::Running && !exe.status.is_terminal(),
            None => false,
        };
        if !running {
            return false;
        }

        // Phase 2 — immutable: snapshot the trajectory data
        let (duration, waypoints) = match self.resolve_execution_trajectory() {
            Some(traj) if !traj.is_empty() && traj.duration() > 0.0 => {
                let wps: Vec<Vec<f64>> = traj.waypoints().iter().map(|w| w.joints().to_vec()).collect();
                (traj.duration(), wps)
            }
            _ => return false,
        };
        let total_steps = waypoints.len().saturating_sub(1);
        if total_steps == 0 {
            return false;
        }

        // Phase 3 — mutable: advance the session
        let progress = match self.execution.as_mut() {
            Some(exe) => exe.advance(dt, duration),
            None => return false,
        };

        // Phase 4 — mutable: interpolate and set joints
        let frac = progress.clamp(0.0, 1.0);
        let idx_f = frac * total_steps as f64;
        let i = idx_f.floor() as usize;
        let j = (i + 1).min(waypoints.len() - 1);
        let local_frac = idx_f - i as f64;

        self.active_robot.joints = waypoints[i]
            .iter()
            .zip(&waypoints[j])
            .map(|(&a, &b)| a + (b - a) * local_frac)
            .collect();

        // Return true while still running
        match self.execution.as_ref() {
            Some(exe) => !exe.status.is_terminal(),
            None => false,
        }
    }

    pub fn trajectory_progress(&self) -> Option<f64> {
        let duration = match self.trajectory_for_progress() {
            Some(t) => t.duration(),
            None => return self.active_plan.as_ref().map(|p| p.progress()),
        };
        self.execution.as_ref().map(|exe| exe.progress(duration))
    }

    /// Resolve the trajectory for advance_trajectory.
    fn resolve_execution_trajectory(&self) -> Option<&Trajectory> {
        // Prefer the scheduled plan (multi-segment program)
        if let Some(ref plan) = self.scheduled_plan {
            return Some(&plan.merged_trajectory);
        }
        // Fall back to active plan only if it's Active (single-shot execution)
        self.active_plan.as_ref().and_then(|p| {
            if p.state == PlanState::Active {
                Some(&p.trajectory)
            } else {
                None
            }
        })
    }

    /// Resolve the trajectory for progress reporting.
    fn trajectory_for_progress(&self) -> Option<&Trajectory> {
        self.scheduled_plan
            .as_ref()
            .map(|p| &p.merged_trajectory)
            .or_else(|| self.active_plan.as_ref().map(|p| &p.trajectory))
    }

    fn next_plan_id(&mut self) -> String {
        let id = self.next_plan_id;
        self.next_plan_id += 1;
        format!("plan-{}", id)
    }
}
