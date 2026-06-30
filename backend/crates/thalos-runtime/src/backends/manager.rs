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
