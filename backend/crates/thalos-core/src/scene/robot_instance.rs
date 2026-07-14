use std::fmt;
use std::str::FromStr;

use thalos_math::Transform3D;
use crate::robot::serial_chain::SerialChain;

/// Identificador único de una instancia de robot dentro de un Scene.
///
/// Es un newtype sobre `u32`. La unicidad es responsabilidad del
/// llamador — Scene no asigna IDs automáticamente.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RobotInstanceId(u32);

impl RobotInstanceId {
    pub fn new(id: u32) -> Self {
        Self(id)
    }

    pub fn get(&self) -> u32 {
        self.0
    }
}

impl fmt::Display for RobotInstanceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for RobotInstanceId {
    type Err = <u32 as FromStr>::Err;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        s.parse::<u32>().map(Self)
    }
}

/// Una instancia concreta de un robot dentro de un Scene.
///
/// Representa un robot ubicado en el mundo con una pose base.
/// El modelo cinemático se comparte via `Arc` para evitar clonar
/// la cadena serial completa.
#[derive(Clone)]
pub struct RobotInstance {
    pub id: RobotInstanceId,
    pub name: String,
    pub model: std::sync::Arc<SerialChain>,
    pub base_pose: Transform3D,
}
