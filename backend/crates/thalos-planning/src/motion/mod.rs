pub struct PlanningContext<'a> {
    pub robot: &'a Robot,
    pub start_state: RobotState,
}

pub trait MotionPlanner {
    type Goal;

    fn plan(
        &self,
        ctx: &PlanningContext,
        goal: Self::Goal,
    ) -> PlanningResult;
}