//! Reachability result type returned by `Workspace::is_reachable`.
//!
//! This is a **domain outcome** enum, not an error type. Validation errors
//! (NaN point, negative tolerance) use `WorkspaceError` instead, so the
//! API remains `Result<Reachability, WorkspaceError>`.

use std::fmt;

/// Outcome of a reachability query.
///
/// - `Reachable` — the point is within `tolerance` of at least one workspace sample.
/// - `OutOfWorkspace { nearest_distance }` — the point is farther than `tolerance`
///   from every sample. `nearest_distance` is the minimum Euclidean distance
///   from the query point to any sample position (always ≥ 0).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Reachability {
    /// The point is within the specified tolerance of at least one sample.
    Reachable,
    /// The point is farther than tolerance from every sample.
    OutOfWorkspace {
        /// Minimum Euclidean distance from the query point to any sample position.
        nearest_distance: f64,
    },
}

impl fmt::Display for Reachability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Reachable => write!(f, "reachable"),
            Self::OutOfWorkspace { nearest_distance } => {
                write!(f, "out of workspace (nearest distance: {})", nearest_distance)
            }
        }
    }
}
