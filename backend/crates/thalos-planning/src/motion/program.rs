use std::ops::Range;

use serde::{Deserialize, Serialize};
use thalos_core::ids::OperationId;
use thalos_core::prelude::Trajectory;

use thalos_core::motion::segment::MotionSegment;

/// A planning program: an ordered sequence of movement commands.
///
/// This is the *input* to the planning system. The `PlanCompiler` transforms
/// it into a `CompiledPlan`. The name reflects the long-term role: a program
/// may eventually include waits, tool changes, IO, and subroutines — just
/// like industrial robot controllers.
#[derive(Debug, Clone)]
pub struct PlanningProgram {
    pub segments: Vec<MotionSegment>,
}

impl PlanningProgram {
    pub fn new(segments: Vec<MotionSegment>) -> Self {
        Self { segments }
    }
}

/// A single segment after planning.
///
/// Preserves both the planned result (`trajectory`) and the original intent
/// (`source`), along with positional metadata for visualization and runtime
/// tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedSegment {
    /// The IR-0 `OperationId` this segment was derived from, copied from
    /// `MotionSegment::origin` (invariant I2).
    pub origin: OperationId,
    /// The original source command — preserves intent and planning parameters.
    pub source: MotionSegment,
    /// The planned trajectory for this segment (time-parameterized joint path).
    pub trajectory: Trajectory,
    /// Indices into the merged trajectory's waypoint vector.
    pub waypoint_range: Range<usize>,
    /// Time range within the merged trajectory's timeline (seconds).
    pub time_range: Range<f64>,
}

/// The result of compiling a `PlanningProgram`.
///
/// This is the *output* of the planning subsystem. The runtime consumes
/// `merged_trajectory` for execution; the segment metadata enables
/// visualization (per-segment colors), progress tracking, and future
/// features like pause/resume at segment boundaries.
///
/// # Runtime contract
///
/// The runtime does **not** need to know about segments or compilation.
/// It receives `merged_trajectory` as a standard `Trajectory` and advances
/// through it as it would any other plan. This keeps the runtime's
/// `advance_trajectory` unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledPlan {
    pub merged_trajectory: Trajectory,
    pub segments: Vec<PlannedSegment>,
    /// Total duration of the merged trajectory.
    pub duration: f64,
    /// Total number of waypoints.
    pub waypoint_count: usize,
}

impl CompiledPlan {
    pub fn new(merged_trajectory: Trajectory, segments: Vec<PlannedSegment>) -> Self {
        let duration = merged_trajectory.duration();
        let waypoint_count = merged_trajectory.len();
        Self {
            merged_trajectory,
            segments,
            duration,
            waypoint_count,
        }
    }

    /// Extrae un segmento de la trayectoria por rango de waypoints.
    ///
    /// Devuelve `None` si el rango está fuera de los límites del plan.
    /// No modifica el plan original.
    pub fn extract_segment(&self, range: std::ops::Range<usize>) -> Option<Trajectory> {
        if range.start >= self.waypoint_count || range.end > self.waypoint_count || range.is_empty()
        {
            return None;
        }
        let waypoints = self.merged_trajectory.waypoints();
        let segment: Vec<_> = waypoints[range.clone()].to_vec();
        Some(Trajectory::new(segment))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::trajectory::TrajectoryPoint;

    fn sample_plan() -> CompiledPlan {
        let points: Vec<TrajectoryPoint> = (0..100)
            .map(|i| TrajectoryPoint::new(vec![i as f64], i as f64))
            .collect();
        CompiledPlan::new(Trajectory::new(points), vec![])
    }

    /// A plan with one MoveJ segment — exercises MotionSegment + Trajectory
    /// + ranges through serde (Q2: CompiledPlan serde).
    fn plan_with_movej_segment() -> CompiledPlan {
        let source = MotionSegment::MoveJ {
            origin: OperationId("op-j".to_string()),
            target: vec![0.5, 1.0],
            max_velocity: Some(500.0),
            max_acceleration: Some(1000.0),
        };
        let trajectory = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 1.0], 1.0),
        ]);
        let segment = PlannedSegment {
            origin: OperationId("op-j".to_string()),
            source,
            trajectory,
            waypoint_range: 0..2,
            time_range: 0.0..1.0,
        };
        let merged = Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 1.0], 1.0),
        ]);
        CompiledPlan::new(merged, vec![segment])
    }

    // ── CompiledPlan serde round-trip (D2, Q2) ───────────────────────────

    #[test]
    fn compiled_plan_serde_round_trip() {
        let plan = plan_with_movej_segment();

        let json = serde_json::to_string(&plan).expect("serialize");
        let decoded: CompiledPlan = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(decoded.duration, plan.duration);
        assert_eq!(decoded.waypoint_count, plan.waypoint_count);
        assert_eq!(decoded.segments.len(), plan.segments.len());

        let seg = &decoded.segments[0];
        assert_eq!(seg.origin, OperationId("op-j".to_string()));
        assert_eq!(seg.time_range, 0.0..1.0);
        assert_eq!(seg.waypoint_range, 0..2);
        assert_eq!(seg.trajectory.len(), 2);
        assert_eq!(seg.trajectory.waypoints()[1].joints(), &[0.5, 1.0]);
        assert_eq!(seg.trajectory.waypoints()[1].timestamp(), 1.0);
        assert!(matches!(seg.source, MotionSegment::MoveJ { .. }));

        // merged trajectory survives losslessly
        assert_eq!(decoded.merged_trajectory.len(), 2);
        assert_eq!(decoded.merged_trajectory.waypoints()[1].joints(), &[0.5, 1.0]);
    }

    #[test]
    fn compiled_plan_serde_json_shape() {
        let plan = plan_with_movej_segment();
        let json = serde_json::to_string(&plan).expect("serialize");
        // Spot-check the shape: origin + time_range present with f64 ranges.
        assert!(json.contains("\"origin\":\"op-j\""), "{json}");
        assert!(json.contains("\"time_range\":{\"start\":0.0,\"end\":1.0}"), "{json}");
        assert!(json.contains("\"duration\":1.0"), "{json}");
    }

    #[test]
    fn test_extract_valid_range() {
        let plan = sample_plan();
        let segment = plan.extract_segment(10..20).unwrap();
        assert_eq!(segment.len(), 10);
    }

    #[test]
    fn test_extract_out_of_bounds_returns_none() {
        let plan = sample_plan();
        assert!(plan.extract_segment(90..110).is_none());
        assert!(plan.extract_segment(100..110).is_none());
    }

    // ── PlanningProgram rename — canonical IR-2 name ──────────────────────

    #[test]
    fn test_extract_preserves_order() {
        let plan = sample_plan();
        let segment = plan.extract_segment(5..8).unwrap();
        let wps = segment.waypoints();
        assert_eq!(wps[0].joints()[0], 5.0);
        assert_eq!(wps[2].joints()[0], 7.0);
    }
}
