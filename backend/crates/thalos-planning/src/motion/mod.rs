use thalos_core::prelude::{RobotState, SerialChain};

use crate::{error::PlanningError, trajectory::Trajectory};

pub struct PlanningContext<'a> {
    pub robot: &'a SerialChain,
    pub start_state: RobotState,
}

pub type PlanningResult = Result<Trajectory, PlanningError>;

pub trait MotionPlanner {
    type Goal;

    fn plan(
        &self,
        ctx: &PlanningContext,
        goal: Self::Goal,
    ) -> PlanningResult;
}