use crate::{
    goal::{JointGoal, ValidatedGoal},
    interpolate::joint,
    motion::planner::{MotionPlanner, PlanningContext, PlanningResult},
    trajectory::Trajectory,
};

#[derive(Debug, Clone)]
pub struct MoveJConfig {
    pub max_velocity: f64,
    pub max_acceleration: f64,
    pub time_step: f64,
}

impl Default for MoveJConfig {
    fn default() -> Self {
        Self {
            max_velocity: 1.0,
            max_acceleration: 0.5,
            time_step: 0.01,
        }
    }
}

pub struct MoveJPlanner {
    pub config: MoveJConfig,
}

impl MoveJPlanner {
    pub fn new(config: MoveJConfig) -> Self {
        Self { config }
    }
}

impl Default for MoveJPlanner {
    fn default() -> Self {
        Self::new(MoveJConfig::default())
    }
}

impl MotionPlanner for MoveJPlanner {
    type Goal = JointGoal;

    fn plan(
        &self,
        ctx: &PlanningContext,
        goal: &ValidatedGoal<JointGoal>,
    ) -> PlanningResult {
        let start = ctx.current_state.as_slice();
        let target = &goal.goal.0;

        let waypoints = joint::trapezoidal_profile(
            start,
            target,
            self.config.max_velocity,
            self.config.max_acceleration,
            self.config.time_step,
        );

        Ok(Trajectory::new(waypoints))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::goal::GoalMetadata;
    use thalos_core::{
        kinematics::inverse::{IKGoal, IKResult, IKSolver},
        models::{RobotModel, RobotRegistry},
        robot::state::RobotState,
    };

    struct NoopIKSolver;

    impl IKSolver for NoopIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> IKResult {
            IKResult::converged(q0.to_vec(), 1, 0.0, None)
        }
    }

    #[test]
    fn plan_returns_trajectory_with_waypoints() {
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let state = RobotState::zero(2);
        let ik = NoopIKSolver;
        let ctx = PlanningContext {
            robot: &robot,
            current_state: &state,
            ik_solver: &ik,
        };
        let planner = MoveJPlanner::default();
        let goal = ValidatedGoal {
            goal: JointGoal(vec![1.0, 1.0]),
            metadata: GoalMetadata::default(),
        };
        let traj = planner.plan(&ctx, &goal).expect("plan should succeed");
        assert!(!traj.is_empty(), "trajectory should have waypoints");
    }

    #[test]
    fn plan_starts_and_ends_at_correct_positions() {
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let state = RobotState::zero(2);
        let ik = NoopIKSolver;
        let ctx = PlanningContext {
            robot: &robot,
            current_state: &state,
            ik_solver: &ik,
        };
        let planner = MoveJPlanner::default();
        let target = vec![1.5, -0.5];
        let goal = ValidatedGoal {
            goal: JointGoal(target.clone()),
            metadata: GoalMetadata::default(),
        };
        let traj = planner.plan(&ctx, &goal).expect("plan should succeed");
        let first = &traj.waypoints()[0];
        let last = &traj.waypoints()[traj.len() - 1];
        for (j, s) in first.joints().iter().zip(ctx.current_state.as_slice()) {
            assert!((j - s).abs() < 1e-10);
        }
        for (j, t) in last.joints().iter().zip(target.iter()) {
            assert!((j - t).abs() < 1e-10);
        }
    }
}
