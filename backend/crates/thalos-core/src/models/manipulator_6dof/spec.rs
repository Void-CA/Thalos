use crate::math::constants::PI;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};

/// Spec geométrica de un manipulador 6DOF (estilo PUMA / UR-like).
///
/// l1..l6 son las longitudes de los 6 links. La convención cinemática concreta
/// (qué eje corresponde a cada joint, qué link se extiende en qué dirección)
/// queda definida por el `factory.rs` cuando se implemente.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Manipulator6DOFSpec {
    pub l1: f64,
    pub l2: f64,
    pub l3: f64,
    pub l4: f64,
    pub l5: f64,
    pub l6: f64,
}

impl Manipulator6DOFSpec {
    pub const fn new(l1: f64, l2: f64, l3: f64, l4: f64, l5: f64, l6: f64) -> Self {
        Self { l1, l2, l3, l4, l5, l6 }
    }
}

pub const DEFAULT: Manipulator6DOFSpec = Manipulator6DOFSpec::new(1.0, 1.0, 1.0, 1.0, 1.0, 1.0);

/// 6 joints revolute — los ejes definitivos los define el factory.
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
    JointInfo {
        name: "joint_4",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
    JointInfo {
        name: "joint_5",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
    JointInfo {
        name: "joint_6",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
];
