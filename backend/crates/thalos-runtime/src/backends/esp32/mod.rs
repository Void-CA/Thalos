//! ESP32 execution backend — connects the `RobotController` trait to an
//! ESP32 running the firmware-side execution engine.
//!
//! The backend performs a batch upload→execute→collect cycle against the
//! ESP32 via `Esp32Protocol`, which owns all text wire-format concerns.

pub mod protocol;

use std::sync::Arc;

use async_trait::async_trait;

use crate::backends::controller::{BackendCapabilities, RobotController};
use crate::backends::transport::Transport;
use crate::error::ControllerError;
use crate::execution_boundary::manifest::{
    ExecutionManifest, ManifestInstruction, ManifestMetadata, ManifestSegment, TimedWaypoint,
};
use crate::state::robot_state::RobotState;

use protocol::{Esp32Protocol, ProtocolError};

/// ESP32 hardware backend.
///
/// Implements `RobotController` by delegating all wire communication to
/// `Esp32Protocol`. The protocol tracks firmware state and handles text
/// encoding/decoding.
pub struct Esp32Backend {
    protocol: Option<Esp32Protocol>,
    connected: bool,
}

impl Esp32Backend {
    /// Create a new `Esp32Backend` over the given transport.
    ///
    /// The transport is wrapped in an `Esp32Protocol` with the expected
    /// protocol version (currently 1). The handshake is not performed
    /// until `connect()` is called.
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self {
            protocol: Some(Esp32Protocol::new(transport, 1)),
            connected: false,
        }
    }

    /// Build an `ExecutionManifest` from raw waypoints and total duration.
    ///
    /// This converts the `RobotController::execute()` parameters into a
    /// format the ESP32 protocol understands. Waypoints are evenly spaced
    /// across the total duration; the first sample always has `dt_us = 0`.
    fn build_manifest(waypoints: &[Vec<f64>], duration: f64) -> ExecutionManifest {
        let total_samples = waypoints.len();
        let duration_us = (duration * 1_000_000.0) as u64;
        let dof = waypoints.first().map(|w| w.len()).unwrap_or(0);

        // Evenly space waypoints across the total duration
        let dt_per_sample = if total_samples > 1 {
            duration_us / (total_samples - 1) as u64
        } else {
            0
        };

        let samples: Vec<TimedWaypoint> = waypoints
            .iter()
            .enumerate()
            .map(|(i, joints)| TimedWaypoint {
                joints: joints.clone(),
                dt_us: if i == 0 { 0 } else { dt_per_sample as u32 },
            })
            .collect();

        let total_dt: u64 = samples.iter().map(|s| s.dt_us as u64).sum();

        ExecutionManifest {
            metadata: ManifestMetadata {
                dof_count: dof,
                total_samples,
                duration_us: total_dt,
            },
            segments: vec![ManifestSegment {
                index: 0,
                instruction: ManifestInstruction::MoveJ,
                sample_start: 0,
                sample_count: total_samples,
            }],
            samples,
        }
    }

    /// Get a mutable reference to the protocol, if connected.
    fn protocol_mut(&mut self) -> Result<&mut Esp32Protocol, ControllerError> {
        self.protocol.as_mut().ok_or(ControllerError::NotConnected)
    }

    /// Validate that the waypoints are acceptable before any wire traffic.
    ///
    /// Returns `Ok(())` or `Err(ControllerError::InvalidManifest)` with
    /// a descriptive message.
    fn validate_manifest(waypoints: &[Vec<f64>], duration: f64) -> Result<(), ControllerError> {
        if waypoints.is_empty() {
            return Err(ControllerError::InvalidManifest(
                "no waypoints provided".into(),
            ));
        }
        if waypoints.iter().any(|w| w.is_empty()) {
            return Err(ControllerError::InvalidManifest(
                "empty joint vector in waypoint".into(),
            ));
        }
        if duration <= 0.0 {
            return Err(ControllerError::InvalidManifest(
                "duration must be positive".into(),
            ));
        }
        // All waypoints must have the same DOF
        let dof = waypoints[0].len();
        if waypoints.iter().any(|w| w.len() != dof) {
            return Err(ControllerError::InvalidManifest(
                "inconsistent DOF across waypoints".into(),
            ));
        }
        Ok(())
    }
}

#[async_trait]
impl RobotController for Esp32Backend {
    async fn connect(&mut self) -> Result<(), ControllerError> {
        if self.connected {
            return Err(ControllerError::AlreadyConnected);
        }

        let protocol = self
            .protocol
            .as_mut()
            .ok_or(ControllerError::NotConnected)?;

        protocol
            .handshake()
            .await
            .map_err(|e| ControllerError::Protocol(format!("handshake failed: {e}")))?;

        self.connected = true;
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), ControllerError> {
        self.connected = false;
        if let Some(protocol) = self.protocol.as_mut() {
            let _ = protocol.stop().await;
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn execute(
        &mut self,
        waypoints: Vec<Vec<f64>>,
        duration: f64,
    ) -> Result<(), ControllerError> {
        if !self.connected {
            return Err(ControllerError::NotConnected);
        }

        // Task 2.10: Validate manifest before any wire traffic
        Self::validate_manifest(&waypoints, duration)?;

        let protocol = self.protocol_mut()?;
        let manifest = Self::build_manifest(&waypoints, duration);

        // Upload → READY
        protocol
            .upload_manifest(&manifest)
            .await
            .map_err(|e| match e {
                ProtocolError::EspError(reason) => {
                    ControllerError::Protocol(format!("upload rejected: {reason}"))
                }
                other => ControllerError::Protocol(format!("upload failed: {other}")),
            })?;

        // Execute → OK
        protocol
            .start_execution()
            .await
            .map_err(|e| ControllerError::Protocol(format!("execute failed: {e}")))?;

        // Return immediately per RobotController contract
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ControllerError> {
        if !self.connected {
            return Err(ControllerError::NotConnected);
        }
        let protocol = self.protocol_mut()?;
        protocol
            .stop()
            .await
            .map_err(|e| ControllerError::Protocol(format!("stop failed: {e}")))?;
        Ok(())
    }

    async fn robot_state(&self) -> Arc<RobotState> {
        // MVP: return a minimal default state
        Arc::new(RobotState::default())
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities::minimal()
    }
}

// ── Test helpers (for integration tests; always available but test-only by contract) ──

impl Esp32Backend {
    /// Expose the protocol's sent commands for integration test verification.
    ///
    /// # Contract
    ///
    /// This method is intended for integration tests ONLY. It provides access
    /// to the raw wire commands sent by the backend for verification purposes.
    /// Production code MUST NOT depend on this method.
    pub fn test_sent_commands(&self) -> Vec<Vec<u8>> {
        self.protocol
            .as_ref()
            .map(|p| p.test_sent_commands())
            .unwrap_or_default()
    }

    /// Expose the protocol for integration test response injection.
    ///
    /// # Contract
    ///
    /// This method is intended for integration tests ONLY. It allows
    /// pre-loading response data into the underlying transport for
    /// simulating firmware interactions.
    pub fn test_inject_response(&self, data: Vec<u8>) {
        if let Some(ref protocol) = self.protocol {
            protocol.test_inject_response(data);
        }
    }
}

// ═════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::transport::FakeTransport;

    /// Helper: create a connected Esp32Backend with a FakeTransport that
    /// will respond with HELLO 1 OK on the first handshake.
    async fn make_connected_backend(transport: FakeTransport) -> Esp32Backend {
        let mut backend = Esp32Backend::new(Box::new(transport));
        // Inject the HELLO response BEFORE connect
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"HELLO 1 OK\n".to_vec());
        backend.connect().await.expect("connect should succeed");
        assert!(backend.is_connected());
        backend
    }

    // ── Task 2.5: RED — full upload→execute→collect cycle ────────────

    #[tokio::test]
    async fn full_cycle_with_fake_transport() {
        let transport = FakeTransport::new();
        let mut backend = make_connected_backend(transport).await;

        // Inject responses for the full upload→execute flow
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // MANIFEST
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // SEGMENT
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // SAMPLE 0
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // SAMPLE 1
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"READY\n".to_vec()); // END_UPLOAD
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // EXECUTE

        // Execute with simple waypoints
        let waypoints = vec![vec![0.0, 0.0], vec![1.0, 1.0]];
        backend
            .execute(waypoints, 1.0)
            .await
            .expect("execute should succeed");
        assert!(backend.is_connected());

        // Verify commands were sent
        let sent = backend.protocol.as_ref().unwrap().test_sent_commands();
        assert!(!sent.is_empty(), "commands should have been sent");

        // HELLO was first (from connect)
        assert_eq!(String::from_utf8(sent[0].clone()).unwrap(), "HELLO 1\n");

        // Check MANIFEST was sent
        let has_manifest = sent.iter().any(|c| c.starts_with(b"MANIFEST"));
        assert!(has_manifest, "MANIFEST should have been sent");

        // Check EXECUTE was sent
        let has_execute = sent.iter().any(|c| c.starts_with(b"EXECUTE"));
        assert!(has_execute, "EXECUTE should have been sent");
    }

    #[tokio::test]
    async fn double_connect_rejected() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"HELLO 1 OK\n".to_vec());
        backend.connect().await.expect("first connect");

        let err = backend.connect().await.unwrap_err();
        assert_eq!(err, ControllerError::AlreadyConnected);
    }

    #[tokio::test]
    async fn execute_requires_connection() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));

        let err = backend.execute(vec![vec![0.0]], 1.0).await.unwrap_err();
        assert_eq!(err, ControllerError::NotConnected);
    }

    // ── Task 2.9: RED — invalid manifest rejected before wire traffic ──

    #[tokio::test]
    async fn empty_waypoints_rejected_before_wire_traffic() {
        let transport = FakeTransport::new();
        // Inject HELLO response BUT NOT any manifest responses
        let mut backend = Esp32Backend::new(Box::new(transport));
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"HELLO 1 OK\n".to_vec());
        backend.connect().await.expect("connect");

        let result = backend.execute(vec![], 1.0).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ControllerError::InvalidManifest(msg) => {
                assert!(!msg.is_empty(), "should have a descriptive message");
            }
            other => panic!("Expected InvalidManifest, got {other:?}"),
        }

        // Verify NO upload commands were sent over the transport
        // Only the 1 HELLO from connect should exist
        let sent = backend.protocol.as_ref().unwrap().test_sent_commands();
        assert_eq!(sent.len(), 1, "only HELLO should have been sent");
        assert_eq!(String::from_utf8(sent[0].clone()).unwrap(), "HELLO 1\n");
    }

    #[tokio::test]
    async fn zero_duration_rejected_before_wire_traffic() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"HELLO 1 OK\n".to_vec());
        backend.connect().await.expect("connect");

        let result = backend.execute(vec![vec![0.0]], 0.0).await;

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ControllerError::InvalidManifest("duration must be positive".into())
        );

        // Only HELLO was sent (from connect)
        assert_eq!(
            backend
                .protocol
                .as_ref()
                .unwrap()
                .test_sent_commands()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn inconsistent_dof_rejected_before_wire_traffic() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"HELLO 1 OK\n".to_vec());
        backend.connect().await.expect("connect");

        let result = backend.execute(vec![vec![0.0, 0.0], vec![1.0]], 1.0).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ControllerError::InvalidManifest(msg) => {
                assert!(msg.contains("DOF"), "message should mention DOF: {msg}");
            }
            other => panic!("Expected InvalidManifest, got {other:?}"),
        }

        // Only HELLO was sent
        assert_eq!(
            backend
                .protocol
                .as_ref()
                .unwrap()
                .test_sent_commands()
                .len(),
            1
        );
    }

    // ── Additional backend tests ─────────────────────────────────────

    #[tokio::test]
    async fn disconnect_sends_stop_and_clears_connected() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));
        backend
            .protocol
            .as_ref()
            .unwrap()
            .test_inject_response(b"HELLO 1 OK\n".to_vec());
        backend.connect().await.expect("connect");
        assert!(backend.is_connected());

        backend
            .disconnect()
            .await
            .expect("disconnect should succeed");
        assert!(!backend.is_connected());
    }

    #[tokio::test]
    async fn capabilities_are_minimal() {
        let transport = FakeTransport::new();
        let backend = Esp32Backend::new(Box::new(transport));

        let caps = backend.capabilities();
        assert!(!caps.pause);
        assert!(!caps.resume);
        assert!(!caps.io);
        assert!(!caps.gripper);
        assert!(!caps.streaming);
    }

    #[test]
    fn build_manifest_creates_correct_structure() {
        let waypoints = vec![vec![0.0, 0.0], vec![0.5, 0.3], vec![1.0, 0.5]];
        let manifest = Esp32Backend::build_manifest(&waypoints, 2.0);

        assert_eq!(manifest.metadata.dof_count, 2);
        assert_eq!(manifest.metadata.total_samples, 3);
        assert_eq!(manifest.metadata.duration_us, 2_000_000);

        assert_eq!(manifest.segments.len(), 1);
        assert_eq!(manifest.segments[0].sample_count, 3);

        // dt evenly spaced: 2_000_000 / 2 = 1_000_000 per sample gap
        assert_eq!(manifest.samples[0].dt_us, 0);
        assert_eq!(manifest.samples[1].dt_us, 1_000_000);
        assert_eq!(manifest.samples[2].dt_us, 1_000_000);
    }

    #[test]
    fn validate_manifest_rejects_dof_mismatch() {
        let result = Esp32Backend::validate_manifest(&[vec![0.0, 0.0], vec![0.0, 0.0, 0.0]], 1.0);
        assert!(result.is_err());
        match result.unwrap_err() {
            ControllerError::InvalidManifest(msg) => {
                assert!(msg.contains("DOF"), "should mention DOF: {msg}");
            }
            other => panic!("Expected InvalidManifest, got {other:?}"),
        }
    }
}
