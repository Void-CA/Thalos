use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un robot SCARA (Selective Compliance Assembly Robot Arm).
///
/// 3 joints revolute en Z + 1 prismatic en Z (movimiento vertical).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScaraSpec {
    pub base_height: f64,
    pub a1: f64,
    pub a2: f64,
    pub d1: f64,
    pub d2: f64,
}

impl ScaraSpec {
    pub const fn new(base_height: f64, a1: f64, a2: f64, d1: f64, d2: f64) -> Self {
        Self { base_height, a1, a2, d1, d2 }
    }
}

pub const DEFAULT: ScaraSpec = ScaraSpec::new(0.5, 1.0, 1.0, -1.0, 1.0);

/// R-R-P-R: revolute, revolute, prismatic, revolute. Todos en Z.
pub const JOINTS: &[JointInfo] = &[
    JointInfo {
        name: "joint_1",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
    JointInfo {
        name: "joint_2",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
    JointInfo {
        name: "joint_3",
        kind: JointKind::Prismatic,
        limits: Some(JointLimits { min: -1.0, max: 1.0 }),
    },
    JointInfo {
        name: "joint_4",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
];
