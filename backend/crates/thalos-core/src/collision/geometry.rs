use crate::math::geometry::vectors::Vector3;

/// Geometría de colisión para un cuerpo.
///
/// Cada variante contiene los parámetros de la forma **en su marco local**
/// (half-extents, radio, etc.). La transformación al marco global se
/// resuelve en [`CollisionBody`](super::body::CollisionBody).
#[derive(Debug, Clone, PartialEq)]
pub enum CollisionGeometry {
    Sphere(Sphere),
    Box(Box3D),
    Cylinder(Cylinder),
}

/// Esfera centrada en el origen local.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sphere {
    pub radius: f64,
}

impl Sphere {
    pub const fn new(radius: f64) -> Self {
        Self { radius }
    }
}

/// Caja orientada (OBB) definida por semi-ejes en el marco local.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Box3D {
    /// Semi-ancho, semi-alto, semi-fondo en el marco local del cuerpo.
    pub half_extents: Vector3,
}

impl Box3D {
    pub fn new(width: f64, height: f64, depth: f64) -> Self {
        Self {
            half_extents: Vector3::new(width / 2.0, height / 2.0, depth / 2.0),
        }
    }

    pub fn from_half_extents(half_extents: Vector3) -> Self {
        Self { half_extents }
    }
}

/// Cilindro con eje longitudinal en Y local.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cylinder {
    pub radius: f64,
    pub height: f64,
}

impl Cylinder {
    pub const fn new(radius: f64, height: f64) -> Self {
        Self { radius, height }
    }
}
