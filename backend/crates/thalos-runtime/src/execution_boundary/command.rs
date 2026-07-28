use std::time::Duration;

/// Flattened execution command ready for `RobotController::execute()`.
///
/// Preserves the relationship between flattened waypoints and their originating
/// segments via `segments`, so that downstream analysis (SDD-006) can compare
/// planned vs. actual execution per segment.
pub struct ExecutionCommand {
    /// Flattened sequence of joint-angle vectors from all trajectory segments.
    pub waypoints: Vec<Vec<f64>>,
    /// Total duration for the entire command (cumulative across segments).
    pub duration: Duration,
    /// Maps ranges in the flattened waypoints back to the original segment indices.
    pub segments: Vec<ExecutionSegmentBoundary>,
}

/// Maps a contiguous range of flattened waypoints back to the original segment.
///
/// # Invariant
///
/// `end_sample - start_sample` equals the number of waypoints contributed by the
/// segment at `index`. Boundaries are listed in plan order and never overlap.
pub struct ExecutionSegmentBoundary {
    /// Index of the segment in `ExecutionPlan::segments`.
    pub index: usize,
    /// First waypoint index (inclusive) in the flattened `ExecutionCommand::waypoints`.
    pub start_sample: usize,
    /// One-past-the-last waypoint index (exclusive) in the flattened waypoints.
    pub end_sample: usize,
}
