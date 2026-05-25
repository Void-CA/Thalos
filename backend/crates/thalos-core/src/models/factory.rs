use crate::robot::serial_chain::SerialChain;

/// Modelos de robot soportados en el sistema.
///
/// Set conocido y finito. Cada variante mapea a un modelo canónico
/// con parámetros por defecto definidos en el registry.
pub enum RobotModel {
    Planar2R,
    Planar3R,
    SingleRevolute,
    Scara,
}

/// Registry concreto de modelos. Único punto de creación canónico.
///
/// Conecta el `RobotModel` enum con las free functions de cada modelo,
/// estableciendo el centro de gravedad del sistema de robots.
pub struct RobotRegistry;

impl RobotRegistry {
    pub fn create(model: RobotModel) -> SerialChain {
        match model {
            RobotModel::Planar2R => super::planar_2r::factory::create_planar_2r(1.0, 1.0),
            RobotModel::Planar3R => super::planar_3r::factory::create_planar_3r(1.0, 1.0, 1.0),
            RobotModel::SingleRevolute => super::single_revolute::factory::create_single_revolute(1.0),
            RobotModel::Scara => super::scara::factory::create_scara_robot(1.0, 1.0, -1.0, 1.0),
        }
    }
}
