use crate::spatial::frame::FrameId;
use crate::spatial::pose::Pose;

/// A single movement command in a motion program.
///
/// This represents the *intent* — what the user wants to happen, not the
/// planned result. The `PlanCompiler` transforms this into a `PlannedSegment`.
///
/// # Extensibility
///
/// New variants (e.g. `Wait`, `SetTool`, `IO`) can be added without changing
/// the compiler — only the dispatcher needs a new arm.
#[derive(Debug, Clone)]
pub enum MotionSegment {
    /// Joint-space move to a target configuration.
    MoveJ {
        target: Vec<f64>,
        max_velocity: Option<f64>,
        max_acceleration: Option<f64>,
    },
    /// Cartesian linear move to a target pose.
    MoveL {
        frame: FrameId,
        target_pose: Pose,
        max_velocity: Option<f64>,
    },
}
