pub use thalos_core::prelude::ActiveRobot;

/// Runtime mutable state: the currently active robot and its joint angles.
pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot) -> Self {
        Self { active_robot }
    }
}
