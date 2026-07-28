pub mod simulation;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use crate::error::ControllerError;
use crate::state::robot_state::RobotState;

/// Descriptor of a backend's capabilities — consumed by the UI to
/// enable/disable buttons.
#[derive(Clone, Debug, PartialEq)]
pub struct BackendCapabilities {
    pub pause: bool,
    pub resume: bool,
    pub io: bool,
    pub gripper: bool,
    pub streaming: bool,
}

impl BackendCapabilities {
    /// Full capabilities — all features supported.
    pub fn full() -> Self {
        Self {
            pause: true,
            resume: true,
            io: true,
            gripper: true,
            streaming: true,
        }
    }

    /// Minimal capabilities — only execution and stop.
    pub fn minimal() -> Self {
        Self {
            pause: false,
            resume: false,
            io: false,
            gripper: false,
            streaming: false,
        }
    }
}

/// Async contract between the Thalos runtime and any controller
/// implementation (simulated, ROS2, serial, EtherCAT, etc.).
///
/// Represents a **controller**, not just a motion backend: it owns
/// the connection, executes trajectories, exposes live state, and
/// (optionally) controls peripherals such as I/O ports and grippers.
///
/// The runtime speaks ONLY to this trait — all backends implement it.
///
/// Device I/O methods have default implementations that return
/// `Err(ControllerError::UnsupportedCapability)`. Backends that
/// support a given operation MUST override the default.
#[async_trait]
pub trait RobotController: Send + Sync {
    /// Open the connection to the robot. Idempotent: calling
    /// `connect` on an already-connected controller returns
    /// `Err(ControllerError::AlreadyConnected)`.
    async fn connect(&mut self) -> Result<(), ControllerError>;

    /// Close the connection. Safe to call when already disconnected.
    async fn disconnect(&mut self) -> Result<(), ControllerError>;

    /// Whether the controller is currently connected.
    fn is_connected(&self) -> bool;

    /// Accept a trajectory and begin execution. Returns immediately —
    /// does NOT block until the trajectory completes. Progress is
    /// observable via `robot_state()`.
    ///
    /// `waypoints`: sequence of joint-angle vectors.
    /// `duration`: total trajectory time in seconds.
    async fn execute(
        &mut self,
        waypoints: Vec<Vec<f64>>,
        duration: f64,
    ) -> Result<(), ControllerError>;

    /// Stop the current execution immediately. Always supported.
    async fn stop(&mut self) -> Result<(), ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }

    /// Pause execution. Requires `BackendCapabilities::pause`.
    async fn pause(&mut self) -> Result<(), ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }

    /// Resume a paused execution. Requires `BackendCapabilities::resume`.
    async fn resume(&mut self) -> Result<(), ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }

    /// Advance simulation time by `dt` seconds.
    ///
    /// Simulation backends implement this to interpolate along the trajectory.
    /// Real hardware backends return `Err(UnsupportedCapability)` — time is real.
    async fn advance(&self, _dt: f64) -> Result<(), ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }

    /// Seek to a position (fraction 0.0–1.0) in the current trajectory.
    ///
    /// Only meaningful for replay/simulation backends.
    /// Real hardware backends return `Err(UnsupportedCapability)`.
    async fn seek(&self, _position: f64) -> Result<(), ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }

    /// Live state of the robot, as an `Arc` for cheap sharing.
    async fn robot_state(&self) -> Arc<RobotState>;

    /// Static capabilities descriptor.
    fn capabilities(&self) -> BackendCapabilities;

    // ── Device I/O — defaults return UnsupportedCapability ──

    /// Set a digital output port.
    async fn set_io(&mut self, _port: u32, _value: bool) -> Result<(), ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }

    /// Wait for a digital input to reach a specific value, with timeout.
    async fn wait_input(
        &mut self,
        _port: u32,
        _value: bool,
        _timeout: Duration,
    ) -> Result<bool, ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }

    /// Set gripper position.
    async fn set_gripper(&mut self, _position: f64) -> Result<(), ControllerError> {
        Err(ControllerError::UnsupportedCapability)
    }
}

// ═════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    pub struct MockController {
        pub connected: AtomicBool,
        pub connect_count: AtomicUsize,
        pub disconnect_count: AtomicUsize,
        pub executed: AtomicBool,
        pub paused: AtomicBool,
        pub capabilities: BackendCapabilities,
    }

    impl MockController {
        pub fn new() -> Self {
            Self {
                connected: AtomicBool::new(false),
                connect_count: AtomicUsize::new(0),
                disconnect_count: AtomicUsize::new(0),
                executed: AtomicBool::new(false),
                paused: AtomicBool::new(false),
                capabilities: BackendCapabilities::full(),
            }
        }
    }

    #[async_trait]
    impl RobotController for MockController {
        async fn connect(&mut self) -> Result<(), ControllerError> {
            if self.connected.load(Ordering::SeqCst) {
                return Err(ControllerError::AlreadyConnected);
            }
            self.connected.store(true, Ordering::SeqCst);
            self.connect_count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        async fn disconnect(&mut self) -> Result<(), ControllerError> {
            self.connected.store(false, Ordering::SeqCst);
            self.disconnect_count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        fn is_connected(&self) -> bool {
            self.connected.load(Ordering::SeqCst)
        }

        async fn execute(
            &mut self,
            _waypoints: Vec<Vec<f64>>,
            _duration: f64,
        ) -> Result<(), ControllerError> {
            if !self.connected.load(Ordering::SeqCst) {
                return Err(ControllerError::NotConnected);
            }
            self.executed.store(true, Ordering::SeqCst);
            Ok(())
        }

        async fn stop(&mut self) -> Result<(), ControllerError> {
            self.executed.store(false, Ordering::SeqCst);
            Ok(())
        }

        async fn pause(&mut self) -> Result<(), ControllerError> {
            if !self.capabilities.pause {
                return Err(ControllerError::UnsupportedCapability);
            }
            self.paused.store(true, Ordering::SeqCst);
            Ok(())
        }

        async fn resume(&mut self) -> Result<(), ControllerError> {
            if !self.capabilities.resume {
                return Err(ControllerError::UnsupportedCapability);
            }
            self.paused.store(false, Ordering::SeqCst);
            Ok(())
        }

        async fn advance(&self, _dt: f64) -> Result<(), ControllerError> {
            Ok(())
        }

        async fn robot_state(&self) -> Arc<RobotState> {
            Arc::new(RobotState::default())
        }

        fn capabilities(&self) -> BackendCapabilities {
            self.capabilities.clone()
        }
    }

    #[tokio::test]
    async fn test_mock_connect_disconnect() {
        let mut ctrl = MockController::new();
        assert!(!ctrl.is_connected());

        ctrl.connect().await.unwrap();
        assert!(ctrl.is_connected());

        ctrl.disconnect().await.unwrap();
        assert!(!ctrl.is_connected());
    }

    #[tokio::test]
    async fn test_double_connect_rejected() {
        let mut ctrl = MockController::new();
        ctrl.connect().await.unwrap();
        let err = ctrl.connect().await.unwrap_err();
        assert_eq!(err, ControllerError::AlreadyConnected);
    }

    #[tokio::test]
    async fn test_execute_requires_connection() {
        let mut ctrl = MockController::new();
        let err = ctrl.execute(vec![], 0.0).await.unwrap_err();
        assert_eq!(err, ControllerError::NotConnected);
    }

    #[tokio::test]
    async fn test_execute_pause_resume_stop_flow() {
        let mut ctrl = MockController::new();
        ctrl.connect().await.unwrap();

        ctrl.execute(vec![vec![0.0]], 1.0).await.unwrap();
        assert!(ctrl.executed.load(Ordering::SeqCst));

        ctrl.pause().await.unwrap();
        assert!(ctrl.paused.load(Ordering::SeqCst));

        ctrl.resume().await.unwrap();
        assert!(!ctrl.paused.load(Ordering::SeqCst));

        ctrl.stop().await.unwrap();
        assert!(!ctrl.executed.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn test_mock_returns_robot_state() {
        let ctrl = MockController::new();
        let state = ctrl.robot_state().await;
        assert_eq!(state.revision, 0);
    }
}
