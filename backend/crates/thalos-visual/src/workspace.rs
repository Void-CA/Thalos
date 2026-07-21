//! Visual representation of a workspace for 3D rendering.
//!
//! `WorkspaceVisual` is a standalone type (not merged into `VisualScene`)
//! because the rendering primitives differ fundamentally: point clouds
//! and wireframe boxes vs. cylinders, spheres, and frames (D2).
//!
//! The frontend (Three.js) handles the actual rendering; these types
//! define the data contract.

use serde::{Deserialize, Serialize};

use thalos_core::analysis::workspace::Workspace;
use thalos_math::Vector3;

use crate::scene::VisualScene;

// ─── WorkspaceVisual ─────────────────────────────────────────────────────

/// Complete visual representation of a sampled workspace.
///
/// - `bounds_wireframe`: AABB edges (12-line box) defined by min/max corners
/// - `samples_points`: The raw position samples as a 3D point cloud
/// - `robot_overlay`: Optional robot `VisualScene` overlaid on the workspace
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceVisual {
    pub bounds_wireframe: BoundsWireframe,
    pub samples_points: SamplePointCloud,
    #[serde(default)]
    pub robot_overlay: Option<VisualScene>,
}

impl WorkspaceVisual {
    /// Build a `WorkspaceVisual` from a `Workspace` dataset.
    ///
    /// - Wireframe is derived from `Workspace::bounds()` (AABB).
    /// - Point cloud is derived from `Workspace::samples()` positions.
    /// - `robot_scene` is an optional overlay (e.g., the current robot pose).
    pub fn from_workspace(
        ws: &Workspace,
        robot_scene: Option<VisualScene>,
    ) -> Self {
        let bb = ws.bounds();

        Self {
            bounds_wireframe: BoundsWireframe {
                min: [bb.min.x, bb.min.y, bb.min.z],
                max: [bb.max.x, bb.max.y, bb.max.z],
            },
            samples_points: SamplePointCloud::from_positions(
                ws.samples().iter().map(|s| s.position),
            ),
            robot_overlay: robot_scene,
        }
    }
}

// ─── BoundsWireframe ────────────────────────────────────────────────────

/// Axis-aligned bounding box wireframe for the workspace envelope.
///
/// The frontend should draw 12 edges connecting the 8 corners:
/// ```ignore
/// Corners indexed as (x: 0=min, 1=max):
///   0: (min.x, min.y, min.z)    1: (max.x, min.y, min.z)
///   2: (min.x, max.y, min.z)    3: (max.x, max.y, min.z)
///   4: (min.x, min.y, max.z)    5: (max.x, min.y, max.z)
///   6: (min.x, max.y, max.z)    7: (max.x, max.y, max.z)
/// Edges along X: 0-1, 2-3, 4-5, 6-7
/// Edges along Y: 0-2, 1-3, 4-6, 5-7
/// Edges along Z: 0-4, 1-5, 2-6, 3-7
/// ```
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct BoundsWireframe {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

impl BoundsWireframe {
    /// Return the 12 edge segments as `[(start, end); 12]`.
    /// Each segment is `[x, y, z]` for start and end.
    pub fn edges(&self) -> [([f64; 3], [f64; 3]); 12] {
        let (x0, x1) = (self.min[0], self.max[0]);
        let (y0, y1) = (self.min[1], self.max[1]);
        let (z0, z1) = (self.min[2], self.max[2]);

        // 8 corners
        let c0 = [x0, y0, z0]; let c1 = [x1, y0, z0];
        let c2 = [x0, y1, z0]; let c3 = [x1, y1, z0];
        let c4 = [x0, y0, z1]; let c5 = [x1, y0, z1];
        let c6 = [x0, y1, z1]; let c7 = [x1, y1, z1];

        [
            (c0, c1), (c2, c3), (c4, c5), (c6, c7),  // X edges
            (c0, c2), (c1, c3), (c4, c6), (c5, c7),  // Y edges
            (c0, c4), (c1, c5), (c2, c6), (c3, c7),  // Z edges
        ]
    }
}

// ─── SamplePointCloud ──────────────────────────────────────────────────

/// A 3D point cloud representing the sampled workspace positions.
///
/// The `points` array uses `[x, y, z]` coordinates. For large workspaces
/// (e.g., 100k samples) the frontend should use `BufferGeometry` with
/// `PointsMaterial` for efficient rendering.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SamplePointCloud {
    pub points: Vec<[f64; 3]>,
    pub count: usize,
}

impl SamplePointCloud {
    /// Build from an iterator of `Vector3` positions.
    pub fn from_positions(positions: impl Iterator<Item = Vector3>) -> Self {
        let points: Vec<[f64; 3]> = positions
            .map(|p| [p.x, p.y, p.z])
            .collect();
        let count = points.len();
        Self { points, count }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::analysis::workspace::{
        sampler::WorkspaceSampler, WorkspaceConfig,
    };
    use thalos_core::models::{RobotModel, RobotRegistry};
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn sample_workspace(model: RobotModel, samples: usize, seed: u64) -> Workspace {
        let mut rng = StdRng::seed_from_u64(seed);
        let chain = RobotRegistry::create_default(model);
        let config = WorkspaceConfig { samples, seed, tolerance: 1e-3 };
        WorkspaceSampler
            .sample(&chain, config, &mut rng)
            .expect("sampling must succeed")
    }

    // 6.2: from_workspace wireframe matches bounds

    #[test]
    fn wireframe_min_max_from_workspace_bounds() {
        let ws = sample_workspace(RobotModel::Scara, 100, 0);
        let vis = WorkspaceVisual::from_workspace(&ws, None);

        let bb = ws.bounds();
        assert_eq!(vis.bounds_wireframe.min, [bb.min.x, bb.min.y, bb.min.z]);
        assert_eq!(vis.bounds_wireframe.max, [bb.max.x, bb.max.y, bb.max.z]);
    }

    #[test]
    fn wireframe_edges_count_is_12() {
        let ws = sample_workspace(RobotModel::Scara, 100, 0);
        let vis = WorkspaceVisual::from_workspace(&ws, None);
        let edges = vis.bounds_wireframe.edges();
        assert_eq!(edges.len(), 12);
        // All edges must be valid (start != end for each)
        for (i, (a, b)) in edges.iter().enumerate() {
            assert_ne!(a, b, "edge {} has zero length: {:?} == {:?}", i, a, b);
        }
    }

    // 6.2: point cloud matches sample positions

    #[test]
    fn point_cloud_matches_sample_positions() {
        let ws = sample_workspace(RobotModel::Planar2R, 50, 0);
        let vis = WorkspaceVisual::from_workspace(&ws, None);

        assert_eq!(vis.samples_points.count, 50);
        assert_eq!(vis.samples_points.points.len(), 50);

        for (i, s) in ws.samples().iter().enumerate() {
            let p = &vis.samples_points.points[i];
            assert!((p[0] - s.position.x).abs() < 1e-12);
            assert!((p[1] - s.position.y).abs() < 1e-12);
            assert!((p[2] - s.position.z).abs() < 1e-12);
        }
    }

    // 6.5: snapshot test

    #[test]
    fn workspace_visual_scara_snapshot() {
        let ws = sample_workspace(RobotModel::Scara, 200, 42);
        let vis = WorkspaceVisual::from_workspace(&ws, None);

        insta::assert_json_snapshot!("workspace_visual_scara", vis);
    }

    #[test]
    fn workspace_visual_planar2r_snapshot() {
        let ws = sample_workspace(RobotModel::Planar2R, 100, 7);
        let vis = WorkspaceVisual::from_workspace(&ws, None);

        insta::assert_json_snapshot!("workspace_visual_planar2r", vis);
    }

    // robot_overlay field

    #[test]
    fn robot_overlay_is_none_when_not_provided() {
        let ws = sample_workspace(RobotModel::Scara, 10, 0);
        let vis = WorkspaceVisual::from_workspace(&ws, None);
        assert!(vis.robot_overlay.is_none());
    }

    #[test]
    fn robot_overlay_is_some_when_provided() {
        let ws = sample_workspace(RobotModel::Scara, 10, 0);
        let dummy_scene = VisualScene::default();
        let vis = WorkspaceVisual::from_workspace(&ws, Some(dummy_scene.clone()));
        assert_eq!(vis.robot_overlay, Some(dummy_scene));
    }
}
