use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un robot cilíndrico RPP (Revolute + Prismatic + Prismatic).
///
/// Convenciones:
/// - `l1`     : altura fija de la base (offset en +Z desde el mundo al primer joint).
/// - `z_min`,
///   `z_max`  : límites del joint prismático vertical (segundo joint, eje Z).
/// - `r_min`,
///   `r_max`  : límites del joint prismático radial (tercer joint, eje X local).
///
/// Cinemática directa (efector en el origen del frame final):
///     p = ( r·cosθ, r·sinθ, l1 + z )
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CylindricalRPPSpec {
    pub l1: f64,
    pub z_min: f64,
    pub z_max: f64,
    pub r_min: f64,
    pub r_max: f64,
}

impl CylindricalRPPSpec {
    pub const fn new(l1: f64, z_min: f64, z_max: f64, r_min: f64, r_max: f64) -> Self {
        Self { l1, z_min, z_max, r_min, r_max }
    }
}

pub const DEFAULT: CylindricalRPPSpec = CylindricalRPPSpec::new(0.5, 0.0, 1.0, 0.0, 1.0);

/// Descriptor cinemático: R(z) – P(z) – P(x).
pub const JOINTS: &[JointInfo] = &[
    JointInfo {
        name: "joint_1",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
    JointInfo {
        name: "joint_2",
        kind: JointKind::Prismatic,
        limits: Some(JointLimits { min: 0.0, max: 1.0 }),
    },
    JointInfo {
        name: "joint_3",
        kind: JointKind::Prismatic,
        limits: Some(JointLimits { min: 0.0, max: 1.0 }),
    },
];
