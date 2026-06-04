use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un robot Planar 3R.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Planar3RSpec {
    pub l1: f64,
    pub l2: f64,
    pub l3: f64,
}

impl Planar3RSpec {
    pub const fn new(l1: f64, l2: f64, l3: f64) -> Self {
        Self { l1, l2, l3 }
    }
}

pub const DEFAULT: Planar3RSpec = Planar3RSpec::new(1.0, 1.0, 1.0);

/// 3 joints revolute en Z.
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
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
];
