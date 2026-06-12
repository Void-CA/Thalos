use thalos_core::kinematics::{
    forward::ForwardKinematics,
    inverse::{DampedLeastSquaresSolver, IKGoal, IKResult, IKSolver},
};
use thalos_core::spatial::frame::FrameId;

pub use thalos_core::prelude::ActiveRobot;

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

/// Runtime mutable state: the currently active robot and its joint angles.
pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot) -> Self {
        Self { active_robot }
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
}
