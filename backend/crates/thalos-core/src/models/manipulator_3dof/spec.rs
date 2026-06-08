use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un manipulador 3DOF estilo PUMA-base (columna vertical).
///
/// Convención Y-up: joint 1 (yaw, eje Y vertical), joint 2 (hombro, eje Z
/// profundidad), joint 3 (codo, eje Z, paralelo a joint 2). Los links se
/// extienden en +X local, así que la posición del efector vive en el plano z=0.
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

/// Y-Z-Z: 1 revolute en Y (vertical), 2 revolutes en Z (profundidad).
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
