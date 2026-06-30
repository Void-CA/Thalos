//! Re-exports from `thalos_models::geometry` for backward compatibility.
//!
//! These types have moved to the canonical model crate. They are
//! re-exported here so existing collision code does not break.

pub use thalos_models::{Sphere, Box3D, Cylinder, CollisionGeometry};
