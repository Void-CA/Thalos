/// The type of motion used to generate a trajectory.
///
/// Determines how the trajectory was planned (joint-space vs cartesian)
/// and affects visualisation styling on the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionType {
    /// Joint-space motion — trapezoidal profile in joint space.
    MoveJ,
    /// Cartesian / linear motion — straight line in task space.
    MoveL,
}
