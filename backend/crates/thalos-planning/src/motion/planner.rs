use thalos_core::{
    kinematics::inverse::IKSolver,
    robot::{serial_chain::SerialChain, state::RobotState},
};

use thalos_core::trajectory::Trajectory;

use crate::{error::PlanningError, goal::ValidatedGoal};

pub struct PlanningContext<'a> {
    pub robot: &'a SerialChain,
    pub current_state: &'a RobotState,
    pub ik_solver: &'a dyn IKSolver,
}

pub type PlanningResult = Result<Trajectory, PlanningError>;

pub trait MotionPlanner {
    type Goal;

    fn plan(&self, ctx: &PlanningContext, goal: &ValidatedGoal<Self::Goal>) -> PlanningResult;
}
