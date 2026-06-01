use thiserror::Error;

use thalos_core::models::RobotModelError;
use thalos_visual::SceneError;

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("scene error: {0}")]
    Scene(SceneError),

    #[error("robot model error: {0}")]
    RobotModel(#[from] RobotModelError),
}

impl From<SceneError> for RuntimeError {
    fn from(e: SceneError) -> Self {
        RuntimeError::Scene(e)
    }
}
