use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un robot Planar 2R.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Planar2RSpec {
    pub l1: f64,
    pub l2: f64,
}

impl Planar2RSpec {
    pub const fn new(l1: f64, l2: f64) -> Self {
        Self { l1, l2 }
    }
}

pub const DEFAULT: Planar2RSpec = Planar2RSpec::new(1.0, 1.0);

/// 2 joints revolute en Z (todo el movimiento ocurre en el plano XY).
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
];
