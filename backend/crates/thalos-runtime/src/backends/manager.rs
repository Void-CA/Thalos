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
    pub async fn get_controller(&self) -> Option<Arc<RwLock<dyn RobotController + Send + Sync>>> {
        self.active.read().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::controller::tests::MockController;
    use crate::error::ControllerError;

    async fn make_controller() -> Arc<RwLock<dyn RobotController + Send + Sync>> {
        let ctrl = MockController::new();
        Arc::new(RwLock::new(ctrl))
    }

    #[tokio::test]
    async fn test_set_active_connects() {
        let manager = BackendManager::new();
        let ctrl = make_controller().await;

        manager.set_active(ctrl.clone()).await.unwrap();
        assert!(manager.is_connected().await);
    }

    #[tokio::test]
    async fn test_double_set_active_rejected() {
        let manager = BackendManager::new();
        let ctrl1 = make_controller().await;
        let ctrl2 = make_controller().await;

        manager.set_active(ctrl1).await.unwrap();
        let err = manager.set_active(ctrl2).await.unwrap_err();
        assert_eq!(err, ControllerError::AlreadyConnected);
    }

    #[tokio::test]
    async fn test_disconnect_cleans() {
        let manager = BackendManager::new();
        let ctrl = make_controller().await;

        manager.set_active(ctrl).await.unwrap();
        assert!(manager.is_connected().await);

        manager.disconnect().await.unwrap();
        assert!(!manager.is_connected().await);
    }

    #[tokio::test]
    async fn test_replace_controller_switches() {
        let manager = BackendManager::new();
        let ctrl1 = make_controller().await;
        let ctrl2 = make_controller().await;

        manager.set_active(ctrl1).await.unwrap();
        assert!(manager.is_connected().await);

        manager.replace_controller(ctrl2).await.unwrap();
        assert!(manager.is_connected().await);
    }

    #[tokio::test]
    async fn test_get_controller_returns_none_when_empty() {
        let manager = BackendManager::new();
        assert!(manager.get_controller().await.is_none());
    }
}
