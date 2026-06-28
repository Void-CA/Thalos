// ── ActiveMotionPlan → ActivePlanDto ──

use thalos_visual::{
    TrajectoryVisualization, VisualMotionType, VisualWaypoint, WaypointType,
};

use crate::features::scene::dto::{
    ActivePlanDto, SegmentInfoDto, TrajectoryVisualizationDto, VisualWaypointDto,
    WaypointTypeDto,
};

impl From<&thalos_runtime::ActiveMotionPlan> for ActivePlanDto {
    fn from(plan: &thalos_runtime::ActiveMotionPlan) -> Self {
        Self {
            plan_id: plan.plan_id.clone(),
            state: format!("{:?}", plan.state),
            motion_type: match plan.motion_type {
                thalos_runtime::MotionType::MoveJ => "movej".into(),
                thalos_runtime::MotionType::MoveL => "movel".into(),
                thalos_runtime::MotionType::Program => "program".into(),
            },
            trajectory_progress: Some(plan.progress()),
            visualization: None,
            segments: plan.segments.as_ref().map(|segs| {
                segs.iter()
                    .enumerate()
                    .map(|(i, seg)| {
                        let motion_type = match &seg.source {
                            thalos_planning::motion::segment::MotionSegment::MoveJ { .. } => {
                                "movej"
                            }
                            thalos_planning::motion::segment::MotionSegment::MoveL { .. } => {
                                "movel"
                            }
                        };
                        SegmentInfoDto {
                            segment_index: i,
                            motion_type: motion_type.into(),
                            waypoint_start: seg.waypoint_range.start,
                            waypoint_end: seg.waypoint_range.end,
                            time_start: seg.time_range.start,
                            time_end: seg.time_range.end,
                        }
                    })
                    .collect()
            }),
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
            thalos_runtime::MotionType::Program => VisualMotionType::MoveJ, // segments colored by frontend
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
            waypoint_type: match w.waypoint_type {
                WaypointType::Start => WaypointTypeDto::Start,
                WaypointType::Goal => WaypointTypeDto::Goal,
                WaypointType::Via => WaypointTypeDto::Via,
            },
        }
    }
}
