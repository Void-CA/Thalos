use chrono::{DateTime, Utc};

use thalos_core::kinematics::{
    forward::ForwardKinematics,
    inverse::{DampedLeastSquaresSolver, IKGoal, IKResult, IKSolver},
};
use thalos_core::prelude::Trajectory;
use thalos_core::spatial::frame::FrameId;

pub use thalos_core::prelude::ActiveRobot;

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

/// Runtime mutable state: the currently active robot and its joint angles.
pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
    pub active_trajectory: Option<Trajectory>,
    pub trajectory_started_at: Option<DateTime<Utc>>,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot) -> Self {
        Self {
            active_robot,
            active_trajectory: None,
            trajectory_started_at: None,
        }
    }

    /// Solve IK for the given frame and goal, then apply the result by updating
    /// `active_robot.joints` in-place. Returns the solver metadata.
    pub fn solve_and_apply_ik(&mut self, frame: FrameId, goal: IKGoal) -> IKResult {
        let fk = ForwardKinematics::new(self.active_robot.chain.clone());
        let solver =
            DampedLeastSquaresSolver::new(fk, frame, IK_MAX_ITERS, IK_TOLERANCE, IK_LAMBDA);
        let q0 = self.active_robot.joints.clone();
        let result = solver.solve(&q0, goal);
        self.active_robot.joints = result.q.clone();
        result
    }

    /// Store a planned trajectory and mark it as active.
    pub fn set_trajectory(&mut self, trajectory: Trajectory) {
        self.active_trajectory = Some(trajectory);
        self.trajectory_started_at = Some(Utc::now());
    }

    /// Clear the active trajectory without applying any state change.
    pub fn clear_trajectory(&mut self) {
        self.active_trajectory = None;
        self.trajectory_started_at = None;
    }

    /// Advance the active trajectory by `dt` seconds (elapsed simulation time).
    /// Updates `active_robot.joints` to the interpolated position at elapsed time.
    /// Returns `true` if the trajectory is still in progress, `false` if complete or no trajectory.
    pub fn advance_trajectory(&mut self, dt: f64) -> bool {
        let Some(ref trajectory) = self.active_trajectory else {
            return false;
        };

        if trajectory.is_empty() {
            self.clear_trajectory();
            return false;
        }

        let elapsed = self
            .trajectory_started_at
            .map(|start| (Utc::now() - start).num_seconds() as f64 + dt)
            .unwrap_or(0.0);

        let waypoints = trajectory.waypoints();
        let duration = trajectory.duration();

        // If beyond duration, use final waypoint and mark complete
        if elapsed >= duration || duration == 0.0 {
            let last = waypoints.last().unwrap();
            self.active_robot.joints = last.joints().to_vec();
            self.clear_trajectory();
            return false;
        }

        // Find surrounding waypoints and interpolate
        let frac = elapsed / duration;
        let total_steps = waypoints.len() - 1;
        let idx_f = frac * total_steps as f64;
        let i = idx_f.floor() as usize;
        let j = (i + 1).min(waypoints.len() - 1);
        let local_frac = idx_f - i as f64;

        let qi = waypoints[i].joints();
        let qj = waypoints[j].joints();

        let interpolated: Vec<f64> = qi
            .iter()
            .zip(qj.iter())
            .map(|(&a, &b)| a + (b - a) * local_frac)
            .collect();

        self.active_robot.joints = interpolated;
        true
    }

    /// Progress of the active trajectory as a fraction 0.0–1.0.
    pub fn trajectory_progress(&self) -> Option<f64> {
        let trajectory = self.active_trajectory.as_ref()?;
        if trajectory.is_empty() {
            return Some(1.0);
        }
        let duration = trajectory.duration();
        if duration == 0.0 {
            return Some(1.0);
        }
        let elapsed = self
            .trajectory_started_at
            .map(|start| (Utc::now() - start).num_seconds() as f64)
            .unwrap_or(0.0);
        Some((elapsed / duration).clamp(0.0, 1.0))
    }
}
