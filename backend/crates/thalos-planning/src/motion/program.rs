use std::ops::Range;

use thalos_core::prelude::Trajectory;

use super::segment::MotionSegment;

/// A motion program: an ordered sequence of movement commands.
///
/// This is the *input* to the planning system. The `PlanCompiler` transforms
/// it into a `CompiledPlan`. The name reflects the long-term role: a program
/// may eventually include waits, tool changes, IO, and subroutines — just
/// like industrial robot controllers.
#[derive(Debug, Clone)]
pub struct MotionProgram {
    pub segments: Vec<MotionSegment>,
}

impl MotionProgram {
    pub fn new(segments: Vec<MotionSegment>) -> Self {
        Self { segments }
    }
}

/// A single segment after planning.
///
/// Preserves both the planned result (`trajectory`) and the original intent
/// (`source`), along with positional metadata for visualization and runtime
/// tracking.
#[derive(Debug, Clone)]
pub struct PlannedSegment {
    /// The original source command — preserves intent and planning parameters.
    pub source: MotionSegment,
    /// The planned trajectory for this segment (time-parameterized joint path).
    pub trajectory: Trajectory,
    /// Indices into the merged trajectory's waypoint vector.
    pub waypoint_range: Range<usize>,
    /// Time range within the merged trajectory's timeline (seconds).
    pub time_range: Range<f64>,
}

/// The result of compiling a `MotionProgram`.
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
#[derive(Debug, Clone)]
pub struct CompiledPlan {
    pub merged_trajectory: Trajectory,
    pub segments: Vec<PlannedSegment>,
    /// Total duration of the merged trajectory.
    pub duration: f64,
    /// Total number of waypoints.
    pub waypoint_count: usize,
}

impl CompiledPlan {
    pub fn new(
        merged_trajectory: Trajectory,
        segments: Vec<PlannedSegment>,
    ) -> Self {
        let duration = merged_trajectory.duration();
        let waypoint_count = merged_trajectory.len();
        Self {
            merged_trajectory,
            segments,
            duration,
            waypoint_count,
        }
    }
}
