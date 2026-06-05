use crate::math::constants::{PI, PI_2};
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un robot esférico-polar RRP (Revolute + Revolute + Prismatic).
///
/// Convenciones:
/// - `l1`     : altura fija de la base (offset en +Z desde el mundo al primer joint).
/// - `r_min`,
///   `r_max`  : límites del joint prismático radial (tercer joint, eje X local).
///
/// Cinemática directa (efector en el origen del frame final, con φ medido desde
/// el plano horizontal hacia abajo, regla de mano derecha sobre Y):
///     p = ( r·cosφ·cosθ, r·cosφ·sinθ, -r·sinφ )
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SphericalPolarRRPSpec {
    pub l1: f64,
    pub r_min: f64,
    pub r_max: f64,
}

impl SphericalPolarRRPSpec {
    pub const fn new(l1: f64, r_min: f64, r_max: f64) -> Self {
        Self { l1, r_min, r_max }
    }
}

pub const DEFAULT: SphericalPolarRRPSpec = SphericalPolarRRPSpec::new(0.5, 0.0, 1.0);

/// Descriptor cinemático: R(z) – R(y) – P(x). φ acotado a ±π/2 para evitar
/// configuraciones invertidas.
pub const JOINTS: &[JointInfo] = &[
    JointInfo {
        name: "joint_1",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
    JointInfo {
        name: "joint_2",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI_2, max: PI_2 }),
    },
    JointInfo {
        name: "joint_3",
        kind: JointKind::Prismatic,
        limits: Some(JointLimits { min: 0.0, max: 1.0 }),
    },
];
