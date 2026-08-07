// ── ActiveMotionPlan → ActivePlanDto ──

use thalos_visual::{TrajectoryVisualization, VisualMotionType, VisualWaypoint, WaypointType};

use crate::features::scene::dto::{
    ActivePlanDto, SegmentInfoDto, TrajectoryVisualizationDto, VisualWaypointDto, WaypointTypeDto,
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
                            thalos_core::motion::segment::MotionSegment::MoveJ { .. } => "movej",
                            thalos_core::motion::segment::MotionSegment::MoveL { .. }
                            | thalos_core::motion::segment::MotionSegment::MoveLPosition {
                                ..
                            } => "movel",
                        };
                        SegmentInfoDto {
                            segment_index: i,
                            motion_type: motion_type.into(),
                            waypoint_start: seg.waypoint_range.start,
                            waypoint_end: seg.waypoint_range.end,
                            time_start: seg.time_range.start,
                            time_end: seg.time_range.end,
                            source: seg.source.clone(),
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
        tcp: Option<&thalos_core::robot::tool_frame::ToolFrame>,
    ) -> Self {
        let mut dto: Self = plan.into();

        let motion_type = match plan.motion_type {
            thalos_runtime::MotionType::MoveJ => VisualMotionType::MoveJ,
            thalos_runtime::MotionType::MoveL => VisualMotionType::MoveL,
            thalos_runtime::MotionType::Program => VisualMotionType::MoveJ, // segments colored by frontend
        };

        let tracked_frame = tcp
            .map(|t| t.base_frame.clone())
            .unwrap_or_else(|| *chain.end_effector());
        let vis = thalos_visual::TrajectoryVisualBuilder::build(
            &plan.trajectory,
            chain,
            tracked_frame,
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

#[cfg(test)]
mod tests {
    use std::ops::Range;

    use serde_json::json;
    use thalos_core::{
        ids::OperationId,
        motion::segment::MotionSegment,
        prelude::{Trajectory, TrajectoryPoint},
        spatial::frame::FrameId,
        spatial::pose::Pose,
    };
    use thalos_math::Transform3D;
    use thalos_planning::motion::program::{CompiledPlan, PlannedSegment};
    use thalos_runtime::{ActiveMotionPlan, MotionType};

    use crate::features::scene::dto::ActivePlanDto;

    fn planned(source: MotionSegment, wpr: Range<usize>, tr: Range<f64>) -> PlannedSegment {
        PlannedSegment {
            origin: source.origin().clone(),
            source,
            trajectory: Trajectory::new(vec![]),
            waypoint_range: wpr,
            time_range: tr,
            operation_id: None,
            role: None,
        }
    }

    fn movej(origin: &str) -> MotionSegment {
        MotionSegment::MoveJ {
            origin: OperationId(origin.to_string()),
            target: vec![0.1, 0.2, 0.3],
            max_velocity: Some(500.0),
            max_acceleration: Some(1000.0),
        }
    }

    fn movel(origin: &str) -> MotionSegment {
        MotionSegment::MoveL {
            origin: OperationId(origin.to_string()),
            frame: FrameId::World,
            target_pose: Pose::new(
                FrameId::World,
                FrameId::Id(1),
                Transform3D::from_translation(thalos_math::Vector3::new(0.3, 0.0, 0.4)),
            ),
            max_velocity: Some(200.0),
        }
    }

    fn movel_position(origin: &str) -> MotionSegment {
        MotionSegment::MoveLPosition {
            origin: OperationId(origin.to_string()),
            frame: FrameId::World,
            target_position: [0.3, 0.0, 0.4],
            max_velocity: Some(200.0),
        }
    }

    fn plan_with(segments: Vec<MotionSegment>) -> ActiveMotionPlan {
        let planned: Vec<PlannedSegment> = segments
            .iter()
            .enumerate()
            .map(|(i, s)| planned(s.clone(), i * 2..i * 2 + 1, i as f64..i as f64 + 0.5))
            .collect();
        let merged = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0], 0.0),
            TrajectoryPoint::new(vec![0.5], 1.0),
        ]);
        ActiveMotionPlan::from_compiled_plan("plan-1", CompiledPlan::new(merged, planned))
    }

    /// The active-plan wire carries the canonical program (`source`) per
    /// segment, with each variant serialized exactly as the core
    /// `MotionSegment` serde emits it.
    #[test]
    fn active_plan_dto_emits_source_per_segment() {
        let plan = plan_with(vec![movej("op-j"), movel("op-l"), movel_position("op-lp")]);
        let dto: ActivePlanDto = (&plan).into();
        let value = serde_json::to_value(&dto).expect("serialize active plan dto");
        let segments = value["segments"].as_array().expect("segments array");

        assert_eq!(segments.len(), 3);
        let s0 = &segments[0];
        assert_eq!(s0["source"]["MoveJ"]["origin"], json!("op-j"));
        assert_eq!(s0["source"]["MoveJ"]["target"], json!([0.1, 0.2, 0.3]));
        assert_eq!(s0["source"]["MoveJ"]["max_velocity"], json!(500.0));
        assert_eq!(s0["source"]["MoveJ"]["max_acceleration"], json!(1000.0));

        let s1 = &segments[1];
        assert_eq!(s1["source"]["MoveL"]["frame"], json!("World"));
        assert_eq!(
            s1["source"]["MoveL"]["target_pose"]["transform"]["translation"]["x"],
            json!(0.3)
        );
        assert_eq!(s1["source"]["MoveL"]["max_velocity"], json!(200.0));

        let s2 = &segments[2];
        assert_eq!(
            s2["source"]["MoveLPosition"]["target_position"],
            json!([0.3, 0.0, 0.4])
        );
    }

    /// Each variant is emitted under its own tag — a MoveJ is never confused
    /// with a MoveLPosition (frontend discriminated-union contract).
    #[test]
    fn movej_and_movel_position_serialize_their_variants() {
        let plan = plan_with(vec![movej("op-j"), movel_position("op-lp")]);
        let dto: ActivePlanDto = (&plan).into();
        let value = serde_json::to_value(&dto).expect("serialize active plan dto");
        let segments = value["segments"].as_array().expect("segments array");

        assert!(segments[0]["source"].get("MoveJ").is_some());
        assert!(segments[0]["source"].get("MoveL").is_none());
        assert!(segments[0]["source"].get("MoveLPosition").is_none());

        assert!(segments[1]["source"].get("MoveLPosition").is_some());
        assert!(segments[1]["source"].get("MoveJ").is_none());
    }

    /// Regression: the existing per-segment metadata contract survives —
    /// `source` is purely additive.
    #[test]
    fn segment_index_and_ranges_survive_with_source() {
        let plan = plan_with(vec![movej("op-j"), movel("op-l")]);
        let dto: ActivePlanDto = (&plan).into();
        let value = serde_json::to_value(&dto).expect("serialize active plan dto");
        let segments = value["segments"].as_array().expect("segments array");

        assert_eq!(segments[0]["segment_index"], json!(0));
        assert_eq!(segments[0]["motion_type"], json!("movej"));
        assert_eq!(segments[0]["waypoint_start"], json!(0));
        assert_eq!(segments[0]["waypoint_end"], json!(1));
        assert_eq!(segments[0]["time_start"], json!(0.0));
        assert_eq!(segments[0]["time_end"], json!(0.5));
        assert!(segments[0]["source"].get("MoveJ").is_some());

        assert_eq!(segments[1]["segment_index"], json!(1));
        assert_eq!(segments[1]["motion_type"], json!("movel"));
        assert_eq!(segments[1]["waypoint_start"], json!(2));
        assert_eq!(segments[1]["waypoint_end"], json!(3));
        assert_eq!(segments[1]["time_start"], json!(1.0));
        assert_eq!(segments[1]["time_end"], json!(1.5));
        assert!(segments[1]["source"].get("MoveL").is_some());
    }
}
