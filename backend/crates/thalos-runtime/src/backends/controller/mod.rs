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
