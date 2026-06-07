use thiserror::Error;

use thalos_core::analysis::workspace::WorkspaceError;
use thalos_core::models::RobotModelError;

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("robot model error: {0}")]
    RobotModel(#[from] RobotModelError),

    #[error("workspace error: {0}")]
    Workspace(#[from] WorkspaceError),
}
