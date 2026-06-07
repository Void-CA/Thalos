//! Core data types for workspace analysis.
//!
//! These structs form the **dataset fundamental** for downstream analysis
//! (singularity map, manipulability map, trajectories). The `Workspace` itself
//! is a separate type defined in `mod.rs` (immutable value object, private fields).

use crate::math::geometry::vectors::Vector3;
use crate::models::RobotModel;

/// One sample of the workspace: the joint configuration and the resulting
/// end-effector position. This is the **atomic unit** of analysis.
///
/// Invariants:
/// - `position == FK(chain, q).ee_position()` (enforced by the sampler).
/// - `q.len() == n_dof` of the robot model.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceSample {
    pub q: Vec<f64>,
    pub position: Vector3,
}

/// Axis-aligned bounding box enclosing all reachable positions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoundingBox {
    pub min: Vector3,
    pub max: Vector3,
}

/// Metrics DERIVED from the position set of a `Workspace`.
///
/// All fields are O(n) on positions. Metrics that require the workspace's
/// true shape (anillo, convex hull, voxelization) are explicitly NOT
/// included here — those are reserved names for future phases
/// (`convex_hull_volume`, `voxelized_volume`, `occupancy_volume`).
///
/// `bounding_volume` is the AABB volume, NOT the workspace's shape volume.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceMetrics {
    /// Volume of the AABB (`(max - min).x * y * z`). NOT the workspace shape volume.
    pub bounding_volume: f64,
    /// Max Euclidean distance from the origin to any sample position.
    pub max_reach: f64,
    /// Min Euclidean distance from the origin to any sample position.
    pub min_reach: f64,
    /// Arithmetic mean of sample positions. NOT a mass centroid, NOT geometric.
    pub centroid: Vector3,
    /// Number of samples (== `Workspace::samples().len()`).
    pub sample_count: usize,
}

/// Cache key for `Workspace` instances.
///
/// Designed to derive `Hash + Eq + Copy` so that a future
/// `HashMap<WorkspaceKey, Arc<Workspace>>` cache is trivial to add
/// (no refactor of the type required). NOT used as a cache key in Phase 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WorkspaceKey {
    pub robot_id: RobotModel,
    pub samples: usize,
    pub seed: u64,
}
