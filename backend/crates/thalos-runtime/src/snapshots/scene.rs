use chrono::{DateTime, Utc};

use thalos_core::models::RobotModel;
use thalos_visual::VisualScene;

/// A point-in-time snapshot of the runtime state.
///
/// Produced by [`SceneService::snapshot`](crate::services::scene::SceneService::snapshot)
/// and [`SceneService::execute`](crate::services::scene::SceneService::execute).
/// The API layer converts this into an HTTP response DTO.
pub struct RuntimeSnapshot {
    /// The active robot model (enum tag, Copy).
    pub robot: RobotModel,
    /// Current joint angles.
    pub joints: Vec<f64>,
    /// The visual scene computed from the current state.
    pub scene: VisualScene,
    /// When this snapshot was taken.
    pub generated_at: DateTime<Utc>,
}
