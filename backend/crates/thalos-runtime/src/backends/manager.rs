use std::sync::Arc;

use tokio::sync::RwLock;

use super::controller::RobotController;
use crate::error::ControllerError;

/// Infrastructure layer that owns controller connections and lifecycle.
///
/// Lives ABOVE the runtime: `SceneService → BackendManager → Runtime → RobotController`.
/// The runtime does NOT know about connection management — it obtains the
/// active controller through the manager.
pub struct BackendManager {
    active: RwLock<Option<Arc<RwLock<dyn RobotController + Send + Sync>>>>,
}

impl BackendManager {
    pub fn new() -> Self {
        Self {
            active: RwLock::new(None),
        }
    }

    /// Register a controller as the active one (sets it connected).
    pub async fn set_active(
        &self,
        controller: Arc<RwLock<dyn RobotController + Send + Sync>>,
    ) -> Result<(), ControllerError> {
        let mut active = self.active.write().await;
        if active.is_some() {
            return Err(ControllerError::AlreadyConnected);
        }
        controller.write().await.connect().await?;
        *active = Some(controller);
        Ok(())
    }

    /// Disconnect and remove the active controller.
    pub async fn disconnect(&self) -> Result<(), ControllerError> {
        let mut active = self.active.write().await;
        if let Some(ctrl) = active.take() {
            ctrl.write().await.disconnect().await?;
        }
        Ok(())
    }

    /// Replace the active controller with a new one.
    ///
    /// Disconnects and removes the previous controller, then connects
    /// and sets the new one. Useful when the robot changes (e.g., new DOF).
    pub async fn replace_controller(
        &self,
        controller: Arc<RwLock<dyn RobotController + Send + Sync>>,
    ) -> Result<(), ControllerError> {
        let mut active = self.active.write().await;
        // Disconnect previous if any
        if let Some(prev) = active.take() {
            let mut guard = prev.write().await;
            let _ = guard.disconnect().await;
        }
        // Connect and set the new one
        controller.write().await.connect().await?;
        *active = Some(controller);
        Ok(())
    }

    /// Is any controller connected?
    pub async fn is_connected(&self) -> bool {
        self.active.read().await.is_some()
    }

    /// Get the active controller for use.
    /// Returns `None` if no controller is connected.
    pub async fn get_controller(
        &self,
    ) -> Option<Arc<RwLock<dyn RobotController + Send + Sync>>> {
        self.active.read().await.clone()
    }
}
