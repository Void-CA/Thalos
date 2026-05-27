use crate::models::{RobotModel, RobotSpec};

#[derive(Debug)]
pub enum RobotModelError {
    ModelSpecMismatch {
        model: RobotModel,
        spec: RobotSpec,
    },
    InvalidRobotId {
        id: String,
    },
}