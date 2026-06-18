use thalos_core::{kinematics::{
    forward::ForwardKinematics,
    inverse::{DampedLeastSquaresSolver, IKGoal, IKResult, IKSolver},
}, prelude::Trajectory};
use thalos_core::spatial::frame::FrameId;

pub use thalos_core::prelude::ActiveRobot;

use crate::plan::{ActiveMotionPlan, MotionType};

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
    pub active_plan: Option<ActiveMotionPlan>,
    next_plan_id: u64,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot) -> Self {
        Self {
            active_robot,
            active_plan: None,
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

    ///
    pub fn set_completed_plan(&mut self, trajectory: impl Into<Trajectory>, motion_type: MotionType) {
        let tid = self.next_plan_id();
        self.active_plan = Some(ActiveMotionPlan::completed(tid, trajectory.into(), motion_type));
    }

    pub fn set_created_plan(&mut self, trajectory: impl Into<Trajectory>, motion_type: MotionType) {
        let tid = self.next_plan_id();
        self.active_plan = Some(ActiveMotionPlan::created(tid, trajectory.into(), motion_type));
    }

    pub fn clear_plan(&mut self) {
        self.active_plan = None;
    }

    pub fn advance_trajectory(&mut self, dt: f64) -> bool {
        let Some(ref plan) = self.active_plan else {
            return false;
        };

        if plan.state.is_terminal() {
            return false;
        }

        let trajectory = &plan.trajectory;
        if trajectory.is_empty() {
            self.clear_plan();
            return false;
        }

        let elapsed = plan
            .started_at
            .map(|start| (Utc::now() - start).num_seconds() as f64 + dt)
            .unwrap_or(0.0);

        let waypoints = trajectory.waypoints();
        let duration = trajectory.duration();

        // If beyond duration, use final waypoint and mark complete
        if elapsed >= duration || duration == 0.0 {
            let last = waypoints.last().unwrap();
            self.active_robot.joints = last.joints().to_vec();
            // Transition to completed if still active
            if let Some(ref mut p) = self.active_plan {
                p.complete();
            }
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

    pub fn trajectory_progress(&self) -> Option<f64> {
        self.active_plan.as_ref().map(|p| p.progress())
    }

    fn next_plan_id(&mut self) -> String {
        let id = self.next_plan_id;
        self.next_plan_id += 1;
        format!("plan-{}", id)
    }
}

// Needed in advance_trajectory for Utc::now()
use chrono::Utc;
