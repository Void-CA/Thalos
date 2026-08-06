use std::sync::Arc;

use tokio::sync::RwLock;

use super::controller::RobotController;
use super::esp32::Esp32Backend;
use super::transport::{SerialTransport, Transport};
use crate::error::ControllerError;
use crate::session::execution_source::ExecutionSource;

/// An available execution backend (resilience-presentation PR2a).
///
/// `controller` is `None` until the hardware backend connects for the FIRST
/// time — the lazy Esp32 factory keeps the serial port closed at boot and
/// only opens it on `connect_with_port`.
#[derive(Clone)]
pub struct BackendEntry {
    pub id: String,
    pub name: String,
    pub controller: Option<Arc<RwLock<dyn RobotController + Send + Sync>>>,
    pub port: Option<String>,
}

/// Infrastructure layer that owns controller connections and lifecycle.
///
/// Lives ABOVE the runtime: `SceneService → BackendManager → Runtime → RobotController`.
/// The runtime does NOT know about connection management — it obtains the
/// active controller through the manager.
pub struct BackendManager {
    active: RwLock<Option<Arc<RwLock<dyn RobotController + Send + Sync>>>>,
    /// Id of the active backend entry ("simulation" | "esp32").
    active_id: RwLock<Option<String>>,
    /// All registered backends; Simulation is always present, Esp32 is
    /// registered conditionally from the environment.
    registered: RwLock<Vec<BackendEntry>>,
}

impl BackendManager {
    pub fn new() -> Self {
        Self {
            active: RwLock::new(None),
            active_id: RwLock::new(None),
            registered: RwLock::new(Vec::new()),
        }
    }

    // ── Backend management (PR2a) ─────────────────────────────────────────

    /// Register an available backend entry. Never opens a serial port.
    pub async fn register(&self, entry: BackendEntry) {
        self.registered.write().await.push(entry);
    }

    /// Register the lazy Esp32 hardware backend from an env-provided port.
    /// The controller is created on the first `connect_with_port` call — no
    /// serial port is opened here.
    pub async fn register_esp32(&self, port: &str) {
        self.register(BackendEntry {
            id: "esp32".into(),
            name: "Hardware (ESP32)".into(),
            controller: None,
            port: Some(port.to_string()),
        })
        .await;
    }

    /// All registered backends (metadata snapshot; controllers shared via Arc).
    pub async fn list_backends(&self) -> Vec<BackendEntry> {
        self.registered.read().await.clone()
    }

    /// Id of the currently active backend entry.
    pub async fn active_id(&self) -> Option<String> {
        self.active_id.read().await.clone()
    }

    /// Make `id` the active backend (PR2a): disconnects the previous active
    /// controller (closing its serial port) and points the runtime at the new
    /// one. A hardware entry that is not yet connected leaves the runtime with
    /// no controller until `connect_with_port` succeeds — execution then
    /// reports the backend's connection state.
    pub async fn activate(&self, id: &str) -> Result<(), ControllerError> {
        let entry = {
            let entries = self.registered.read().await;
            entries.iter().find(|e| e.id == id).cloned()
        };
        let entry = entry.ok_or_else(|| ControllerError::NotFound(id.to_string()))?;

        let mut active = self.active.write().await;
        // Disconnect the previous active controller (if any) — closes its port.
        if let Some(prev) = active.take() {
            let _ = prev.write().await.disconnect().await;
        }
        if let Some(ctrl) = &entry.controller {
            let mut guard = ctrl.write().await;
            if !guard.is_connected() {
                guard.connect().await?;
            }
            *active = Some(ctrl.clone());
        }
        *self.active_id.write().await = Some(id.to_string());
        Ok(())
    }

    /// Connect the hardware backend `id` to `port` (lazy Esp32 factory, PR2a).
    ///
    /// - unknown id → `NotFound`
    /// - serial port cannot be opened (missing/occupied device) → `PortInUse`
    /// - port opens but no firmware answers the HELLO handshake → `NoFirmware`
    ///
    /// On success the connected controller is stored in the backend entry and
    /// becomes the runtime controller when that backend is active.
    pub async fn connect_with_port(&self, id: &str, port: &str) -> Result<(), ControllerError> {
        let transport = SerialTransport::new(port, 115200);
        self.connect_with_transport(id, port, Box::new(transport)).await
    }

    /// Connect with an injected transport — the shared implementation behind
    /// `connect_with_port`. Test-support by contract: production code always
    /// builds a `SerialTransport`; tests inject a fake to exercise the
    /// firmware-handshake paths without a real serial device.
    pub async fn connect_with_transport(
        &self,
        id: &str,
        port: &str,
        mut transport: Box<dyn Transport>,
    ) -> Result<(), ControllerError> {
        {
            let entries = self.registered.read().await;
            if !entries.iter().any(|e| e.id == id) {
                return Err(ControllerError::NotFound(id.to_string()));
            }
        }
        // Port-level failure (missing/occupied device) → port_in_use.
        transport
            .connect()
            .await
            .map_err(|e| ControllerError::PortInUse(e.to_string()))?;

        // Port opened but no firmware answers the HELLO handshake → no_firmware.
        let mut backend = Esp32Backend::new(transport);
        backend
            .connect()
            .await
            .map_err(|_| ControllerError::NoFirmware)?;

        let ctrl = Arc::new(RwLock::new(backend))
            as Arc<RwLock<dyn RobotController + Send + Sync>>;
        {
            let mut entries = self.registered.write().await;
            if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
                entry.controller = Some(ctrl.clone());
                entry.port = Some(port.to_string());
            }
        }
        // If this backend is the active one, point the runtime at the new
        // controller immediately.
        if self.active_id.read().await.as_deref() == Some(id) {
            *self.active.write().await = Some(ctrl);
        }
        Ok(())
    }

    /// Disconnect a connected backend (PR2a). `not_connected` when the backend
    /// has no connected controller.
    pub async fn disconnect_backend(&self, id: &str) -> Result<(), ControllerError> {
        let mut entries = self.registered.write().await;
        let entry = entries
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| ControllerError::NotFound(id.to_string()))?;
        let ctrl = entry
            .controller
            .take()
            .ok_or(ControllerError::NotConnected)?;
        let mut guard = ctrl.write().await;
        if guard.is_connected() {
            guard.disconnect().await?;
        }
        if self.active_id.read().await.as_deref() == Some(id) {
            *self.active.write().await = None;
        }
        Ok(())
    }

    // ── Legacy lifecycle (unchanged) ──────────────────────────────────────

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
        *active = Some(controller.clone());
        // Keep the registered Simulation entry in sync so `GET /backends`
        // reflects the controller the runtime actually uses (PR2a).
        if let Some(entry) = self
            .registered
            .write()
            .await
            .iter_mut()
            .find(|e| e.id == "simulation")
        {
            entry.controller = Some(controller);
        }
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

    /// Execution source of the ACTIVE controller (R4-001) — reflects the real
    /// backend (Simulation vs Hardware) on the wire instead of a hardcoded
    /// value. Falls back to Simulation when no controller is connected.
    pub async fn active_source(&self) -> ExecutionSource {
        match self.get_controller().await {
            Some(ctrl) => ctrl.read().await.execution_source(),
            None => ExecutionSource::Simulation,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::controller::tests::MockController;
    use crate::backends::transport::FakeTransport;
    use crate::error::ControllerError;

    async fn make_controller() -> Arc<RwLock<dyn RobotController + Send + Sync>> {
        let ctrl = MockController::new();
        Arc::new(RwLock::new(ctrl))
    }

    // ── Backend management (resilience-presentation PR2a) ────────────────

    #[tokio::test]
    async fn list_backends_returns_registered_entries() {
        let manager = BackendManager::new();
        let ctrl = make_controller().await;
        manager
            .register(BackendEntry {
                id: "simulation".into(),
                name: "Simulation".into(),
                controller: Some(ctrl),
                port: None,
            })
            .await;
        manager.register_esp32("/dev/ttyUSB0").await;

        let backends = manager.list_backends().await;
        assert_eq!(backends.len(), 2);
        assert_eq!(backends[0].id, "simulation");
        assert_eq!(backends[1].id, "esp32");
        assert_eq!(backends[1].port.as_deref(), Some("/dev/ttyUSB0"));
        assert!(
            backends[1].controller.is_none(),
            "esp32 must NOT open a port at boot (lazy factory)"
        );
    }

    #[tokio::test]
    async fn activate_switches_active_backend() {
        let manager = BackendManager::new();
        let ctrl = make_controller().await;
        manager
            .register(BackendEntry {
                id: "simulation".into(),
                name: "Simulation".into(),
                controller: Some(ctrl.clone()),
                port: None,
            })
            .await;
        manager.activate("simulation").await.unwrap();

        assert_eq!(manager.active_id().await.as_deref(), Some("simulation"));
        assert!(manager.get_controller().await.is_some());
    }

    #[tokio::test]
    async fn activate_unknown_backend_returns_not_found() {
        let manager = BackendManager::new();
        let err = manager.activate("unknown").await.unwrap_err();
        assert_eq!(err, ControllerError::NotFound("unknown".into()));
    }

    #[tokio::test]
    async fn activate_esp32_without_connect_leaves_runtime_without_controller() {
        let manager = BackendManager::new();
        let ctrl = make_controller().await;
        manager
            .register(BackendEntry {
                id: "simulation".into(),
                name: "Simulation".into(),
                controller: Some(ctrl),
                port: None,
            })
            .await;
        manager.activate("simulation").await.unwrap();
        manager.register_esp32("/dev/ttyUSB0").await;
        manager.activate("esp32").await.unwrap();

        assert_eq!(manager.active_id().await.as_deref(), Some("esp32"));
        assert!(
            manager.get_controller().await.is_none(),
            "hardware active-but-not-connected has no controller"
        );
    }

    #[tokio::test]
    async fn disconnect_esp32_without_controller_returns_not_connected() {
        let manager = BackendManager::new();
        manager.register_esp32("/dev/ttyUSB0").await;
        let err = manager.disconnect_backend("esp32").await.unwrap_err();
        assert_eq!(err, ControllerError::NotConnected);
    }

    #[tokio::test]
    async fn connect_with_port_unknown_backend_returns_not_found() {
        let manager = BackendManager::new();
        let err = manager
            .connect_with_port("nope", "/dev/ttyUSB0")
            .await
            .unwrap_err();
        assert_eq!(err, ControllerError::NotFound("nope".into()));
    }

    #[tokio::test]
    async fn connect_with_port_to_invalid_device_returns_port_in_use() {
        let manager = BackendManager::new();
        manager.register_esp32("/dev/thalos-tests-nonexistent-7f3c").await;
        let err = manager
            .connect_with_port("esp32", "/dev/thalos-tests-nonexistent-7f3c")
            .await
            .unwrap_err();
        assert!(
            matches!(err, ControllerError::PortInUse(_)),
            "open failure must map to port_in_use, got {err:?}"
        );
    }

    #[tokio::test]
    async fn connect_with_transport_no_firmware_response_returns_no_firmware() {
        let manager = BackendManager::new();
        manager.register_esp32("/dev/ttyUSB0").await;
        // FakeTransport with NO injected HELLO response → handshake times out.
        let transport = Box::new(FakeTransport::new());
        let err = manager
            .connect_with_transport("esp32", "/dev/ttyUSB0", transport)
            .await
            .unwrap_err();
        assert_eq!(err, ControllerError::NoFirmware);

        let entry = manager
            .list_backends()
            .await
            .into_iter()
            .find(|e| e.id == "esp32")
            .unwrap();
        assert!(
            entry.controller.is_none(),
            "failed connect must not leave a controller"
        );
    }

    #[tokio::test]
    async fn connect_with_transport_success_stores_controller_and_port() {
        let manager = BackendManager::new();
        manager.register_esp32("/dev/ttyUSB0").await;
        let transport = FakeTransport::new();
        transport.inject_response(b"HELLO 1 OK\n".to_vec());
        manager
            .connect_with_transport("esp32", "/dev/ttyUSB0", Box::new(transport))
            .await
            .unwrap();

        let entry = manager
            .list_backends()
            .await
            .into_iter()
            .find(|e| e.id == "esp32")
            .unwrap();
        assert!(entry.controller.is_some(), "controller stored after connect");
        assert_eq!(entry.port.as_deref(), Some("/dev/ttyUSB0"));
    }

    #[tokio::test]
    async fn connect_active_backend_becomes_runtime_controller() {
        let manager = BackendManager::new();
        manager.register_esp32("/dev/ttyUSB0").await;
        manager.activate("esp32").await.unwrap();
        assert!(manager.get_controller().await.is_none());

        let transport = FakeTransport::new();
        transport.inject_response(b"HELLO 1 OK\n".to_vec());
        manager
            .connect_with_transport("esp32", "/dev/ttyUSB0", Box::new(transport))
            .await
            .unwrap();

        assert!(
            manager.get_controller().await.is_some(),
            "connecting the active backend must point the runtime at it"
        );
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
