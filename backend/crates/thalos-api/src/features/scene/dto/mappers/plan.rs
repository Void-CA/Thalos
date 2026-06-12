// ── ActiveMotionPlan → ActivePlanDto ──

use thalos_visual::{
    TrajectoryVisualization, VisualMotionType, VisualWaypoint,
};

use crate::features::scene::dto::{
    ActivePlanDto, TrajectoryVisualizationDto, VisualWaypointDto,
};

impl From<&thalos_runtime::ActiveMotionPlan> for ActivePlanDto {
    fn from(plan: &thalos_runtime::ActiveMotionPlan) -> Self {
        Self {
            plan_id: plan.plan_id.clone(),
            state: format!("{:?}", plan.state),
            motion_type: match plan.motion_type {
                thalos_runtime::MotionType::MoveJ => "movej".into(),
                thalos_runtime::MotionType::MoveL => "movel".into(),
            },
            trajectory_progress: Some(plan.progress()),
            visualization: None, // filled separately via build_visualization
            created_at: plan.created_at,
            started_at: plan.started_at,
            completed_at: plan.completed_at,
        }
    }
}

impl ActivePlanDto {
    /// Build an ActivePlanDto including the trajectory visualization.
    pub fn with_visualization(
        plan: &thalos_runtime::ActiveMotionPlan,
        chain: &thalos_core::robot::serial_chain::SerialChain,
    ) -> Self {
        let mut dto: Self = plan.into();

        let motion_type = match plan.motion_type {
            thalos_runtime::MotionType::MoveJ => VisualMotionType::MoveJ,
            thalos_runtime::MotionType::MoveL => VisualMotionType::MoveL,
        };

        let ee = *chain.end_effector();
        let vis = thalos_visual::TrajectoryVisualBuilder::build(
            &plan.trajectory,
            chain,
            ee,
            motion_type,
        );

        dto.visualization = Some(vis.into());
        dto
    }
}

// ── TrajectoryVisualization → TrajectoryVisualizationDto ──

impl From<TrajectoryVisualization> for TrajectoryVisualizationDto {
    fn from(v: TrajectoryVisualization) -> Self {
        Self {
            waypoints: v.waypoints.into_iter().map(Into::into).collect(),
            motion_type: format!("{:?}", v.motion_type).to_lowercase(),
        }
    }
}

impl From<VisualWaypoint> for VisualWaypointDto {
    fn from(w: VisualWaypoint) -> Self {
        Self {
            position: w.position,
            orientation: w.orientation,
            joints: w.joints,
            timestamp: w.timestamp,
            is_start: w.is_start,
            is_end: w.is_end,
        }
    }
}
