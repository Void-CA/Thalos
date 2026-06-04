use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un robot SingleRevolute.
///
/// `l` es la longitud del único link (extendido en +X local del joint).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SingleRevoluteSpec {
    pub l: f64,
}

impl SingleRevoluteSpec {
    pub const fn new(l: f64) -> Self {
        Self { l }
    }
}

pub const DEFAULT: SingleRevoluteSpec = SingleRevoluteSpec::new(1.0);

/// Descriptor cinemático del robot: 1 joint revolute en Z.
pub const JOINTS: &[JointInfo] = &[JointInfo {
    name: "joint_1",
    kind: JointKind::Revolute,
    limits: Some(JointLimits { min: -PI, max: PI }),
}];
