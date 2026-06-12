use thiserror::Error;

use thalos_core::analysis::workspace::WorkspaceError;
use thalos_core::models::RobotModelError;

use thalos_planning::error::PlanningError;

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("robot model error: {0}")]
    RobotModel(#[from] RobotModelError),

    #[error("workspace error: {0}")]
    Workspace(#[from] WorkspaceError),

    #[error("planning error: {0}")]
    Planning(#[from] PlanningError),
}
