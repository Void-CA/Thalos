use crate::robot::serial_chain::SerialChain;

// ── Modelo (identidad) ───────────────────────────────────────────────────

/// Identidad del robot. Set conocido y finito.
///
/// Representa *qué es* el robot, no cómo está configurado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RobotModel {
    Planar2R,
    Planar3R,
    SingleRevolute,
    Scara,
}

// ── Spec (configuración) ─────────────────────────────────────────────────

/// Configuración de parámetros por modelo.
///
/// Representa *cómo está configurado* el robot. Cada variante pertenece
/// a un `RobotModel` específico — el registry valida la consistencia.
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

// ── Registry ─────────────────────────────────────────────────────────────

/// Registry concreto de modelos. Único punto de creación canónico.
pub struct RobotRegistry;

impl RobotRegistry {
    /// Construye un robot validando consistencia model/spec.
    pub fn create(model: RobotModel, spec: RobotSpec) -> SerialChain {
        match (&model, &spec) {
            (RobotModel::Planar2R, RobotSpec::Planar2R { l1, l2 }) => {
                super::planar_2r::factory::create_planar_2r(*l1, *l2)
            }
            (RobotModel::Planar3R, RobotSpec::Planar3R { l1, l2, l3 }) => {
                super::planar_3r::factory::create_planar_3r(*l1, *l2, *l3)
            }
            (RobotModel::SingleRevolute, RobotSpec::SingleRevolute { l1 }) => {
                super::single_revolute::factory::create_single_revolute(*l1)
            }
            (RobotModel::Scara, RobotSpec::Scara { a1, a2, d1, d2 }) => {
                super::scara::factory::create_scara_robot(*a1, *a2, *d1, *d2)
            }
            _ => panic!("RobotModel/Spec mismatch: {:?} vs {:?}", model, spec),
        }
    }

    /// Construye un robot con parámetros por defecto para el modelo dado.
    pub fn create_default(model: RobotModel) -> SerialChain {
        let spec = match model {
            RobotModel::Planar2R => RobotSpec::Planar2R {
                l1: 1.0,
                l2: 1.0,
            },
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
        };
        Self::create(model, spec)
    }
}
