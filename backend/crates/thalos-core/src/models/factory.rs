use std::f64::consts::PI;

use crate::models::RobotMetadata;
use crate::models::error::RobotModelError;
use crate::robot::joint::{JointInfo, JointKind, JointLimits};
use crate::robot::serial_chain::SerialChain;

// ── Static joint descriptors per robot model ──

const JOINTS_SINGLE_REVOLUTE: &[JointInfo] = &[JointInfo {
    name: "joint_1",
    kind: JointKind::Revolute,
    limits: Some(JointLimits { min: -PI, max: PI }),
}];

const JOINTS_PLANAR_2R: &[JointInfo] = &[
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

const JOINTS_PLANAR_3R: &[JointInfo] = &[
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

const JOINTS_SCARA: &[JointInfo] = &[
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
        limits: Some(JointLimits {
            min: -1.0,
            max: 1.0,
        }),
    },
    JointInfo {
        name: "joint_4",
        kind: JointKind::Revolute,
        limits: Some(JointLimits { min: -PI, max: PI }),
    },
];

const JOINTS_MANIPULATOR_3DOF: &[JointInfo] = &[
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

const JOINTS_MANIPULATOR_6DOF: &[JointInfo] = &[
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RobotModel {
    Planar2R,
    Planar3R,
    SingleRevolute,
    Scara,
    Manipulator3DOF,
    Manipulator6DOF,
}

impl RobotModel {
    pub fn metadata(&self) -> RobotMetadata {
        match self {
            RobotModel::Planar2R => RobotMetadata {
                id: "planar_2r",
                display_name: "Planar 2R",
                dof: 2,
                joints: JOINTS_PLANAR_2R,
            },
            RobotModel::Planar3R => RobotMetadata {
                id: "planar_3r",
                display_name: "Planar 3R",
                dof: 3,
                joints: JOINTS_PLANAR_3R,
            },
            RobotModel::SingleRevolute => RobotMetadata {
                id: "single_revolute",
                display_name: "Single Revolute",
                dof: 1,
                joints: JOINTS_SINGLE_REVOLUTE,
            },
            RobotModel::Scara => RobotMetadata {
                id: "scara",
                display_name: "SCARA",
                dof: 4,
                joints: JOINTS_SCARA,
            },
            RobotModel::Manipulator3DOF => RobotMetadata {
                id: "manipulator_3dof",
                display_name: "Manipulator 3DOF",
                dof: 3,
                joints: JOINTS_MANIPULATOR_3DOF,
            },
            RobotModel::Manipulator6DOF => RobotMetadata {
                id: "manipulator_6dof",
                display_name: "Manipulator 6DOF",
                dof: 6,
                joints: JOINTS_MANIPULATOR_6DOF,
            },
        }
    }

    pub fn default_spec(&self) -> RobotSpec {
        match self {
            RobotModel::Planar2R => RobotSpec::Planar2R { l1: 1.0, l2: 1.0 },
            RobotModel::Planar3R => RobotSpec::Planar3R {
                l1: 1.0,
                l2: 1.0,
                l3: 1.0,
            },
            RobotModel::SingleRevolute => RobotSpec::SingleRevolute { l1: 1.0 },
            RobotModel::Scara => RobotSpec::Scara {
                a1: 1.0,
                a2: 1.0,
                d1: -1.0,
                d2: 1.0,
            },
        }
    }

    pub fn from_id(id: &str) -> Result<RobotModel, RobotModelError> {
        match id {
            "planar_2r" => Ok(RobotModel::Planar2R),
            "planar_3r" => Ok(RobotModel::Planar3R),
            "single_revolute" => Ok(RobotModel::SingleRevolute),
            "scara" => Ok(RobotModel::Scara),
            _ => Err(RobotModelError::InvalidRobotId { id: id.to_string() }),
        }
    }
    pub fn all() -> &'static [RobotModel] {
        &[
            RobotModel::Planar2R,
            RobotModel::Planar3R,
            RobotModel::SingleRevolute,
            RobotModel::Scara,
        ]
    }
}


#[derive(Debug, Clone)]
pub enum RobotSpec {
    Planar2R {
        l1: f64,
        l2: f64,
    },
    Planar3R {
        l1: f64,
        l2: f64,
        l3: f64,
    },
    SingleRevolute {
        l1: f64,
    },
    Scara {
        a1: f64,
        a2: f64,
        d1: f64,
        d2: f64,
    },
    Manipulator3DOF {
        l1: f64,
        l2: f64,
        l3: f64,
    },  
    Manipulator6DOF {
        l1: f64,
        l2: f64,
        l3: f64,
        l4: f64,
        l5: f64,
        l6: f64,
    },
}

pub struct RobotRegistry;

impl RobotRegistry {
    /// Construye un robot validando consistencia model/spec.
    pub fn create(model: RobotModel, spec: RobotSpec) -> Result<SerialChain, RobotModelError> {
        match (&model, &spec) {
            (RobotModel::Planar2R, RobotSpec::Planar2R { l1, l2 }) => {
                Ok(super::planar_2r::factory::create_planar_2r(*l1, *l2))
            }
            (RobotModel::Planar3R, RobotSpec::Planar3R { l1, l2, l3 }) => {
                Ok(super::planar_3r::factory::create_planar_3r(*l1, *l2, *l3))
            }
            (RobotModel::SingleRevolute, RobotSpec::SingleRevolute { l1 }) => {
                Ok(super::single_revolute::factory::create_single_revolute(*l1))
            }
            (RobotModel::Scara, RobotSpec::Scara { a1, a2, d1, d2 }) => {
                Ok(super::scara::factory::create_scara_robot(*a1, *a2, *d1, *d2))
            }
            _ => Err(RobotModelError::ModelSpecMismatch { model, spec }),
        }
    }

    /// Construye un robot con parámetros por defecto para el modelo dado.
    pub fn create_default(model: RobotModel) -> SerialChain {
        let spec = model.default_spec();
        Self::create(model, spec).unwrap()
    }
}
