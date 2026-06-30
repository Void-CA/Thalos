//! Canonical robot model types.
//!
//! This crate defines **what a robot is**: its structure, components,
//! and physical properties. Every type here is pure data — no kinematic
//! algorithms, no runtime state, no frame systems.
//!
//! These types map 1:1 to URDF concepts and can be serialised without
//! loss of meaning.
//!
//! ── Sub-modules ──────────────────────────────────────────────────
//!
//! | Module      | Contains                                     |
//! |-------------|----------------------------------------------|
//! | `robot`     | `Robot`, the top-level container             |
//! | `link`      | `Link`, `Inertial`                           |
//! | `joint`     | `Joint`, `JointKind`, `JointLimits`          |
//! | `geometry`  | `Geometry`, `Visual`, `Collision`            |
//! | `material`  | `Material`, `Color`                          |
//! | `graph`     | `RobotGraph`, `Path`, `LinkId`, `JointId`    |
//! | `urdf`      | URDF parser and exporter (future)            |

pub mod robot;
pub mod link;
pub mod joint;
pub mod geometry;
pub mod material;
pub mod graph;
pub mod urdf;

pub use robot::Robot;
pub use link::{Link, Inertial};
pub use joint::{Joint, JointKind, JointLimits};
pub use geometry::{Geometry, Visual, Collision, CollisionGeometry, Sphere, Box3D, Cylinder, Mesh};
pub use material::{Material, Color};
pub use graph::{RobotGraph, Path, LinkId, JointId};
