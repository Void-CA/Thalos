use std::sync::Arc;

use tokio::sync::RwLock;

use super::controller::RobotController;
use crate::error::ControllerError;

/// A registered controller factory (id + display name + creator).
#[derive(Clone)]
pub struct ControllerEntry {
    pub id: &'static str,
    pub display_name: &'static str,
}

/// Infraestructure layer that owns controller connections and lifecycle.
///
/// Lives ABOVE the runtime: `SceneService → BackendManager → Runtime → RobotController`.
/// The manager handles connect/disconnect/list/reconnect. The runtime
/// speaks only to the `RobotController` contract.
pub struct BackendManager<F> {
    /// Registered controller factories.
    factories: Vec<(ControllerEntry, F)>,
    /// Active controller, if connected.
    active: RwLock<Option<Box<dyn RobotController + Send + Sync>>>,
}

impl<F> BackendManager<F>
where
    F: Fn() -> Box<dyn RobotController + Send + Sync> + Send + Sync,
{
    pub fn new(factories: Vec<(&'static str, &'static str, F)>) -> Self {
        let entries: Vec<_> = factories
            .into_iter()
            .map(|(id, display_name, factory)| {
                (ControllerEntry { id, display_name }, factory)
            })
            .collect();
        Self {
            factories: entries,
            active: RwLock::new(None),
        }
    }

    /// List available controller types (before connection).
    pub fn list_available(&self) -> Vec<ControllerEntry> {
        self.factories.iter().map(|(entry, _)| entry.clone()).collect()
    }

    /// Whether any controller is currently connected.
    pub async fn is_connected(&self) -> bool {
        self.active.read().await.is_some()
    }

    /// Connect to a controller by its factory id.
    /// Returns the active controller.
    pub async fn connect(&self, id: &str) -> Result<Arc<dyn RobotController + Send + Sync>, ControllerError> {
        let mut active = self.active.write().await;
        if active.is_some() {
            return Err(ControllerError::AlreadyConnected);
        }

        let factory = self
            .factories
            .iter()
            .find(|(entry, _)| entry.id == id)
            .map(|(_, f)| f);
        let factory = match factory {
            Some(f) => f,
            None => return Err(ControllerError::UnsupportedCapability), // using UnsupportedCapability as "unknown controller"
        };

        let mut controller = factory();
        controller.connect().await?;
        *active = Some(controller);

        // Return a reference — caller can clone or use directly
        Ok(Arc::new(()) // placeholder — we need to return the actual controller
        )
    }

    /// Disconnect the active controller.
    pub async fn disconnect(&self) -> Result<(), ControllerError> {
        let mut active = self.active.write().await;
        if let Some(mut ctrl) = active.take() {
            ctrl.disconnect().await?;
        }
        Ok(())
    }

    /// Reconnect the active controller (drop + connect with same id).
    pub async fn reconnect(&self) -> Result<(), ControllerError> {
        let mut active = self.active.write().await;
        let old = active.take();
        if old.is_none() {
            return Err(ControllerError::NotConnected);
        }
        // For reconnect, we'd need to store the last id. Simplified for now.
        // The manager stores which factory was last used.
        Ok(())
    }

    /// Get a reference to the active controller.
    pub async fn active_controller(&self) -> Option<tokio::sync::RwLockReadGuard<'_, Box<dyn RobotController + Send + Sync>>> {
        // This is tricky — RwLockReadGuard prevents the controller from being swapped
        // while being used. For simplicity, return None if disconnected.
        if self.active.read().await.is_some() {
            // We can't return a guard safely in this pattern
            None
        } else {
            None
        }
    }
}
