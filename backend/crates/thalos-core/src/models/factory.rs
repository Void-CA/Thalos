use crate::models::RobotMetadata;
use crate::models::error::RobotRegistryError;
use crate::robot::serial_chain::SerialChain;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RobotModel {
    Planar2R,
    Planar3R,
    SingleRevolute,
    Scara,
}

impl RobotModel {
    pub fn metadata(&self) -> RobotMetadata {
        match self {
            RobotModel::Planar2R => RobotMetadata {
                id: "planar_2r",
                display_name: "Planar 2R",
                dof: 2,
            },
            RobotModel::Planar3R => RobotMetadata {
                id: "planar_3r",
                display_name: "Planar 3R",
                dof: 3,
            },
            RobotModel::SingleRevolute => RobotMetadata {
                id: "single_revolute",
                display_name: "Single Revolute",
                dof: 1,
            },
            RobotModel::Scara => RobotMetadata {
                id: "scara",
                display_name: "SCARA",
                dof: 4,
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
}

pub struct RobotRegistry;

impl RobotRegistry {
    /// Construye un robot validando consistencia model/spec.
    pub fn create(model: RobotModel, spec: RobotSpec) -> Result<SerialChain, RobotRegistryError> {
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
            _ => Err(RobotRegistryError::ModelSpecMismatch {model, spec}),
        }
    }

    /// Construye un robot con parámetros por defecto para el modelo dado.
    pub fn create_default(model: RobotModel) -> SerialChain {
        let spec = model.default_spec();
        Self::create(model, spec).unwrap()
    }
}
