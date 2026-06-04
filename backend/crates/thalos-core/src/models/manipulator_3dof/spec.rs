use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un manipulador 3DOF estilo PUMA-base (columna vertical).
///
/// Convención: joint 1 (yaw, eje Z) sobre columna vertical l1, joint 2 (hombro,
/// eje Y), joint 3 (codo, eje Y paralelo a joint 2). Los links se extienden
/// en +X local, así que la posición del efector vive en el plano y=0.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Manipulator3DOFSpec {
    pub l1: f64,
    pub l2: f64,
    pub l3: f64,
}

impl Manipulator3DOFSpec {
    pub const fn new(l1: f64, l2: f64, l3: f64) -> Self {
        Self { l1, l2, l3 }
    }
}

pub const DEFAULT: Manipulator3DOFSpec = Manipulator3DOFSpec::new(1.0, 1.0, 1.0);

/// Z-Y-Y: 1 revolute en Z, 2 revolutes en Y.
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
