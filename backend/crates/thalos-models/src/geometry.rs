use thalos_math::{Transform3D, Vector3};
use crate::Material;

/// A shape used in both visual and collision elements.
#[derive(Debug, Clone, PartialEq)]
pub enum Geometry {
    Sphere { radius: f64 },
    Box { width: f64, height: f64, depth: f64 },
    Cylinder { radius: f64, height: f64 },
    Mesh { filename: String, scale: Option<Vector3> },
}

/// Visual element of a link.
///
/// Corresponds to `<visual>` in URDF.
#[derive(Debug, Clone, PartialEq)]
pub struct Visual {
    pub origin: Transform3D,
    pub geometry: Geometry,
    pub material: Option<Material>,
}

impl Visual {
    pub fn new(origin: Transform3D, geometry: Geometry) -> Self {
        Self {
            origin,
            geometry,
            material: None,
        }
    }
}

/// Collision element of a link.
///
/// Corresponds to `<collision>` in URDF.
#[derive(Debug, Clone, PartialEq)]
pub struct Collision {
    pub origin: Transform3D,
    pub geometry: Geometry,
}

impl Collision {
    pub fn new(origin: Transform3D, geometry: Geometry) -> Self {
        Self { origin, geometry }
    }
}
