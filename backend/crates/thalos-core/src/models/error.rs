use crate::models::{RobotModel, RobotSpec};

#[derive(Debug)]
pub enum RobotRegistryError {
    ModelSpecMismatch {
        model: RobotModel,
        spec: RobotSpec,
    },
}