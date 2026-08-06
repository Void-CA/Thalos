use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        inverse::{IKGoal, IKStatus},
    },
    spatial::pose::Pose,
};

use crate::{
    error::PlanningError,
    goal::{ResolvedPoseGoal, ResolvedPositionGoal, ValidatedGoal},
    interpolate::cartesian,
    motion::planner::{PlanningContext, PlanningResult, SegmentPlanner},
    trajectory::{Trajectory, TrajectoryPoint},
};
use thalos_math::Transform3D;

#[derive(Debug, Clone)]
pub struct MoveLConfig {
    pub max_velocity: f64,
    pub max_acceleration: f64,
    pub time_step: f64,
    pub cartesian_step: f64,
}

impl Default for MoveLConfig {
    fn default() -> Self {
        Self {
            max_velocity: 0.25,
            max_acceleration: 0.125,
            time_step: 0.01,
            cartesian_step: 0.01,
        }
    }
}

pub struct MoveLPlanner {
    pub config: MoveLConfig,
}

impl MoveLPlanner {
    pub fn new(config: MoveLConfig) -> Self {
        Self { config }
    }
}

impl Default for MoveLPlanner {
    fn default() -> Self {
        Self::new(MoveLConfig::default())
    }
}

impl SegmentPlanner for MoveLPlanner {
    type Goal = ValidatedGoal<ResolvedPoseGoal>;

    fn plan(
        &self,
        ctx: &PlanningContext,
        goal: &ValidatedGoal<ResolvedPoseGoal>,
    ) -> PlanningResult {
        let target_pose = &goal.goal.pose;

        let fk = ForwardKinematics::new(ctx.robot.clone());
        let fk_result = fk.evaluate(ctx.current_state.as_slice());
        let start_pose = fk_result.ee_pose().ok_or_else(|| {
            PlanningError::InvalidGoal("End-effector pose not found in FK result".into())
        })?;
        let start_transform = start_pose.transform().clone();
        let end_transform = target_pose.transform().clone();

        let cartesian_waypoints =
            cartesian::linear_path(&start_transform, &end_transform, self.config.cartesian_step);

        let n = cartesian_waypoints.len();
        let mut trajectory = Trajectory::new(Vec::with_capacity(n));

        let total_distance = ((end_transform.translation.x - start_transform.translation.x)
            .powi(2)
            + (end_transform.translation.y - start_transform.translation.y).powi(2)
            + (end_transform.translation.z - start_transform.translation.z).powi(2))
        .sqrt();

        let mut q_current = ctx.current_state.as_slice().to_vec();

        for (i, transform) in cartesian_waypoints.iter().enumerate() {
            let is_last = i == n - 1;

            if is_last {
                // Use the validated resolved state — the resolver already paid IK + analysis
                q_current = goal.goal.state.as_slice().to_vec();
            } else {
                let waypoint_pose = Pose::new(
                    target_pose.reference_id(),
                    target_pose.target_id(),
                    transform.clone(),
                );

                let ik_result = ctx.ik_solver.solve(&q_current, IKGoal::Pose(waypoint_pose))?;

                match ik_result.status {
                    IKStatus::Converged => {
                        q_current = ik_result.q;
                    }
                    IKStatus::MaxIterations => {
                        return Err(PlanningError::IkFailed {
                            target_pose: target_pose.clone(),
                            reason: crate::error::IkFailureReason::NoSolution,
                        });
                    }
                }
            }

            let progress = if n > 1 {
                i as f64 / (n - 1) as f64
            } else {
                0.0
            };
            let timestamp = if self.config.max_velocity > 1e-12 {
                progress * total_distance / self.config.max_velocity
            } else {
                progress
            };

            trajectory.push(TrajectoryPoint::new(q_current.clone(), timestamp));
        }

        Ok(trajectory)
    }
}

impl MoveLPlanner {
    /// Plan a translation-only Cartesian move for a [`ResolvedPositionGoal`].
    ///
    /// Interpolates the translation-only path and drives every intermediate
    /// waypoint with `IKGoal::Position` — never `IKGoal::Pose`. This is what
    /// lets a SCARA (4 DOF, yaw-only) execute MoveL: a full 6-DOF pose goal
    /// leaves irreducible roll/pitch error and dies at `MaxIterations`.
    pub fn plan_position(
        &self,
        ctx: &PlanningContext,
        goal: &ValidatedGoal<ResolvedPositionGoal>,
    ) -> PlanningResult {
        let target = goal.goal.position;

        let fk = ForwardKinematics::new(ctx.robot.clone());
        let fk_result = fk.evaluate(ctx.current_state.as_slice());
        let start_pose = fk_result.ee_pose().ok_or_else(|| {
            PlanningError::InvalidGoal("End-effector pose not found in FK result".into())
        })?;
        let start_transform = Transform3D::from_translation(start_pose.translation());
        let end_transform = Transform3D::from_translation(target);

        let cartesian_waypoints =
            cartesian::linear_path(&start_transform, &end_transform, self.config.cartesian_step);

        let n = cartesian_waypoints.len();
        let mut trajectory = Trajectory::new(Vec::with_capacity(n));

        let total_distance = (target - start_pose.translation()).magnitude();

        let mut q_current = ctx.current_state.as_slice().to_vec();

        for (i, transform) in cartesian_waypoints.iter().enumerate() {
            let is_last = i == n - 1;

            if is_last {
                // Use the validated resolved state — the resolver already paid IK + analysis
                q_current = goal.goal.state.as_slice().to_vec();
            } else {
                let ik_result = ctx
                    .ik_solver
                    .solve(&q_current, IKGoal::Position(transform.translation))?;

                match ik_result.status {
                    IKStatus::Converged => {
                        q_current = ik_result.q;
                    }
                    IKStatus::MaxIterations => {
                        return Err(PlanningError::IkFailedPosition {
                            target_position: [target.x, target.y, target.z],
                            reason: crate::error::IkFailureReason::NoSolution,
                        });
                    }
                }
            }

            let progress = if n > 1 {
                i as f64 / (n - 1) as f64
            } else {
                0.0
            };
            let timestamp = if self.config.max_velocity > 1e-12 {
                progress * total_distance / self.config.max_velocity
            } else {
                progress
            };

            trajectory.push(TrajectoryPoint::new(q_current.clone(), timestamp));
        }

        Ok(trajectory)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::goal::{GoalMetadata, PlanningAssessment, ResolvedPoseGoal, ResolvedPositionGoal};
    use thalos_core::{
        kinematics::inverse::{IKResult, IKSolver, IkError},
        models::{RobotModel, RobotRegistry},
        robot::state::RobotState,
    };

    struct NoopIKSolver;

    impl IKSolver for NoopIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult::converged(q0.to_vec(), 1, 0.0, None))
        }
    }

    #[test]
    fn plan_with_noop_ik_returns_trajectory() {
        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let state = RobotState::zero(2);
        let ik = NoopIKSolver;
        let ctx = PlanningContext {
            robot: &robot,
            current_state: &state,
            ik_solver: &ik,
            tcp: None,
        };

        let planner = MoveLPlanner::default();
        let fk = ForwardKinematics::new(robot.clone());
        let result = fk.evaluate(&[0.5, 0.3]);
        let target_pose = result.ee_pose().cloned().unwrap();

        let goal = ValidatedGoal {
            goal: ResolvedPoseGoal {
                pose: target_pose,
                state: RobotState::new(vec![0.5, 0.3]),
            },
            metadata: GoalMetadata::default(),
            assessment: PlanningAssessment::accepted(),
        };

        let traj = planner.plan(&ctx, &goal).expect("plan should succeed");
        assert!(!traj.is_empty(), "trajectory should have waypoints");
    }

    /// Position-only MoveL on a SCARA: the planner must interpolate the
    /// translation-only path with `IKGoal::Position` (never `IKGoal::Pose`)
    /// so the 4-DOF, yaw-only robot converges — the exact failure that
    /// produced `422 segment_n_failed` before this fix.
    #[test]
    fn plan_position_converges_on_scara() {
        use thalos_core::kinematics::inverse::DampedLeastSquaresSolver;
        use thalos_math::Vector3;

        let robot = RobotRegistry::create_default(RobotModel::Scara);
        let state = RobotState::zero(4);
        // Well within the SCARA workspace (r_xy = 0.78 > r_min 0.50).
        let target = Vector3::new(0.6, 0.5, 0.25);

        let fk = ForwardKinematics::new(robot.clone());
        let solver = DampedLeastSquaresSolver::new(
            fk,
            robot.end_effector().clone(),
            500,
            1e-6,
            0.1,
        );
        let resolved = solver
            .solve(&[0.0, 0.0, 0.0, 0.0], IKGoal::Position(target))
            .expect("position IK must converge on SCARA");
        assert!(matches!(resolved.status, IKStatus::Converged));

        let ctx = PlanningContext {
            robot: &robot,
            current_state: &state,
            ik_solver: &solver,
            tcp: None,
        };

        let goal = ValidatedGoal {
            goal: ResolvedPositionGoal {
                position: target,
                state: RobotState::new(resolved.q),
            },
            metadata: GoalMetadata::default(),
            assessment: PlanningAssessment::accepted(),
        };

        let planner = MoveLPlanner::default();
        let traj = planner
            .plan_position(&ctx, &goal)
            .expect("position-only MoveL must converge on SCARA");
        assert!(!traj.is_empty(), "trajectory should have waypoints");

        let last = traj.waypoints().last().unwrap().joints().to_vec();
        let fk2 = ForwardKinematics::new(robot.clone());
        let ee = fk2.evaluate(&last).ee_pose().unwrap().translation();
        let error = (ee - target).magnitude();
        assert!(
            error < 0.02,
            "EE position error {error:.4} (expected {target:?}, got {ee:?})"
        );
    }
}
