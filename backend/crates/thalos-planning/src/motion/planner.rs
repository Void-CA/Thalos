use thalos_core::{
    kinematics::inverse::IKSolver,
    robot::{serial_chain::SerialChain, state::RobotState, tool_frame::ToolFrame},
};

use thalos_core::trajectory::Trajectory;

use crate::{error::PlanningError, goal::ValidatedGoal};

pub struct PlanningContext<'a> {
    pub robot: &'a SerialChain,
    pub current_state: &'a RobotState,
    pub ik_solver: &'a dyn IKSolver,
    /// Active Tool Center Point (TCP) frame.
    ///
    /// When `Some`, singularity and manipulability analysis reference the TCP.
    /// When `None`, reference the flange (end effector).
    pub tcp: Option<&'a ToolFrame>,
}

pub type PlanningResult = Result<Trajectory, PlanningError>;

pub trait MotionPlanner {
    type Goal;

    fn plan(&self, ctx: &PlanningContext, goal: &ValidatedGoal<Self::Goal>) -> PlanningResult;
}
