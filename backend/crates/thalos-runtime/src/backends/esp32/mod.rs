//! ESP32 execution backend — connects the `RobotController` trait to an
//! ESP32 running the firmware-side execution engine.
//!
//! The backend performs a batch upload→execute→collect cycle against the
//! ESP32 via `Esp32Protocol`, which owns all text wire-format concerns.

pub mod protocol;

use std::sync::Arc;

use async_trait::async_trait;

use crate::backends::controller::{BackendCapabilities, RobotController};
use crate::backends::transport::{Transport, TransportError};
use crate::error::ControllerError;
use crate::execution_boundary::manifest::{
    ExecutionManifest, ManifestInstruction, ManifestMetadata, ManifestSegment, TimedWaypoint,
};
use crate::execution_boundary::manifest_builder::ExecutionManifestBuilder;
use crate::session::execution_source::ExecutionSource;
use crate::state::robot_state::RobotState;
use thalos_core::execution::plan::{
    ExecutionInstruction, ExecutionPlan, ExecutionSegment, ExecutionWaypoint,
};

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

    /// Build an [`ExecutionManifest`] from raw waypoints and total duration.
    ///
    /// # Migration shim (deprecated)
    ///
    /// The canonical chain is
    /// `CompiledPlan → ExecutionPlanBuilder → ExecutionPlan →
    /// ExecutionManifestBuilder`. This method keeps the legacy
    /// `RobotController::execute()` contract working without callers opting
    /// into the pure chain: it constructs the [`ExecutionPlan`] the legacy
    /// algorithm implied (even spacing, a single MoveJ segment covering every
    /// sample, first `dt_us = 0`) and delegates to [`ExecutionManifestBuilder`],
    /// which emits bit-identical output to the old inline algorithm for the
    /// same input. The one exception is a sub-(N−1)-microsecond duration,
    /// handled by the degenerate branch in the body (see its comment).
    ///
    /// # Panics
    ///
    /// Panics if the pure builder rejects the input. After the degenerate
    /// sub-microsecond branch, the only builder rejection still reachable is
    /// an empty waypoint slice (`EMPTY_MANIFEST`); the production call site
    /// (`execute`) validates via `validate_manifest` first, so the panic is
    /// unreachable there.
    #[deprecated(note = "use ExecutionManifestBuilder via ExecutionPlanBuilder")]
    fn build_manifest(waypoints: &[Vec<f64>], duration: f64) -> ExecutionManifest {
        let total_samples = waypoints.len();
        let duration_us = (duration * 1_000_000.0) as u64;
        // Legacy even-spacing: integer division, first sample dt = 0.
        let dt_per_sample = if total_samples > 1 {
            duration_us / (total_samples - 1) as u64
        } else {
            0
        };

        // Degenerate case: a duration shorter than (N-1) µs truncates the
        // per-gap delta to zero, so every reconstructed timestamp collapses
        // to 0.0 and the builder's dedup CANNOT represent the input — it
        // either returns `Err(DedupConflict)` (equal timestamp, different
        // joints), panicking the `.expect()` below inside the production
        // `execute()` path, or silently collapses N distinct commanded
        // waypoints into one sample when joints are bit-equal. Legacy
        // behavior was total: an N-sample manifest with all `dt_us = 0`
        // (`duration_us` = 0) that the firmware validator accepts (timing
        // diff 0 <= 1000 µs floor). Bypass the builder and reproduce that
        // output exactly.
        if total_samples > 1 && dt_per_sample == 0 {
            return ExecutionManifest {
                metadata: ManifestMetadata {
                    dof_count: waypoints.first().map(|w| w.len()).unwrap_or(0),
                    total_samples,
                    duration_us: 0,
                },
                segments: vec![ManifestSegment {
                    index: 0,
                    instruction: ManifestInstruction::MoveJ,
                    sample_start: 0,
                    sample_count: total_samples,
                }],
                samples: waypoints
                    .iter()
                    .map(|joints| TimedWaypoint {
                        joints: joints.clone(),
                        dt_us: 0,
                    })
                    .collect(),
            };
        }

        // Absolute timestamps chosen so the builder's `round()` reproduces
        // `dt_per_sample` exactly, and a declared duration equal to the legacy
        // SUMMED `duration_us` (sum of dt — NOT `round(duration * 1e6)` when
        // the integer division truncates).
        let plan = ExecutionPlan {
            waypoints: waypoints
                .iter()
                .enumerate()
                .map(|(i, joints)| ExecutionWaypoint {
                    joints: joints.clone(),
                    timestamp: i as f64 * dt_per_sample as f64 / 1_000_000.0,
                })
                .collect(),
            segments: vec![ExecutionSegment {
                index: 0,
                planned_segment_index: 0,
                instruction: ExecutionInstruction::MoveJ,
                waypoint_range: 0..total_samples,
            }],
            duration: (total_samples.saturating_sub(1) as u64 * dt_per_sample) as f64 / 1_000_000.0,
        };

        ExecutionManifestBuilder::build(&plan).expect(
            "build_manifest inputs are validated by execute(); the pure builder only rejects degenerate input",
        )
    }

    /// Get a mutable reference to the protocol, if connected.
    fn protocol_mut(&mut self) -> Result<&mut Esp32Protocol, ControllerError> {
        self.protocol.as_mut().ok_or(ControllerError::NotConnected)
    }

    /// Map a protocol-layer failure to a `ControllerError` (R4-001): a
    /// transport that reports `Disconnected` means the device vanished
    /// mid-operation → `ConnectionLost` (so the frontend offers Reconectar);
    /// everything else stays a generic `Protocol` error.
    fn map_protocol_error(context: &str, e: ProtocolError) -> ControllerError {
        match e {
            ProtocolError::Transport(TransportError::Disconnected) => {
                ControllerError::ConnectionLost
            }
            other => ControllerError::Protocol(format!("{context}: {other}")),
        }
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
            .map_err(|e| Self::map_protocol_error("handshake failed", e))?;

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
        // The legacy shim is deprecated; execute() still consumes it until the
        // RobotController path migrates to the pure chain (separate SDD).
        #[allow(deprecated)]
        let manifest = Self::build_manifest(&waypoints, duration);

        // Upload → READY
        protocol
            .upload_manifest(&manifest)
            .await
            .map_err(|e| Self::map_protocol_error("upload failed", e))?;

        // Execute → OK
        protocol
            .start_execution()
            .await
            .map_err(|e| Self::map_protocol_error("execute failed", e))?;

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
            .map_err(|e| Self::map_protocol_error("stop failed", e))?;
        Ok(())
    }

    async fn robot_state(&self) -> Arc<RobotState> {
        // MVP: return a minimal default state
        Arc::new(RobotState::default())
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities::minimal()
    }

    /// The ESP32 is a real hardware execution backend: report `Hardware` so the
    /// UI execution-source badge reflects the actual controller instead of the
    /// `Simulation` default (review fix R4-001).
    fn execution_source(&self) -> ExecutionSource {
        ExecutionSource::Hardware
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
    #![allow(deprecated)] // build_manifest is deprecated by design (PR 3)

    use super::*;
    use crate::backends::transport::{FakeTransport, TransportError};
    use crate::execution_boundary::manifest::ManifestInstruction;
    use crate::execution_boundary::manifest_builder::ExecutionManifestBuilder;
    use thalos_core::execution::plan::{
        ExecutionInstruction, ExecutionPlan, ExecutionSegment, ExecutionWaypoint,
    };

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

    /// Test transport that answers the HELLO handshake once, then reports the
    /// device disconnected on every subsequent `receive` (mid-operation drop).
    struct DisconnectAfterHandshake {
        handshaken: std::sync::atomic::AtomicBool,
    }

    impl DisconnectAfterHandshake {
        fn new() -> Self {
            Self {
                handshaken: std::sync::atomic::AtomicBool::new(false),
            }
        }
    }

    #[async_trait]
    impl Transport for DisconnectAfterHandshake {
        async fn connect(&mut self) -> Result<(), TransportError> {
            Ok(())
        }
        async fn disconnect(&mut self) -> Result<(), TransportError> {
            Ok(())
        }
        async fn send(&mut self, _data: &[u8]) -> Result<(), TransportError> {
            Ok(())
        }
        async fn receive(&mut self) -> Result<Vec<u8>, TransportError> {
            if !self
                .handshaken
                .swap(true, std::sync::atomic::Ordering::SeqCst)
            {
                Ok(b"HELLO 1 OK\n".to_vec())
            } else {
                Err(TransportError::Disconnected)
            }
        }
    }

    /// Test transport that is disconnected from the start — every receive
    /// reports the transport lost.
    struct AlwaysDisconnected;

    #[async_trait]
    impl Transport for AlwaysDisconnected {
        async fn connect(&mut self) -> Result<(), TransportError> {
            Ok(())
        }
        async fn disconnect(&mut self) -> Result<(), TransportError> {
            Ok(())
        }
        async fn send(&mut self, _data: &[u8]) -> Result<(), TransportError> {
            Ok(())
        }
        async fn receive(&mut self) -> Result<Vec<u8>, TransportError> {
            Err(TransportError::Disconnected)
        }
    }

    /// R4-001: a transport that reports `Disconnected` mid-operation must
    /// surface as `ControllerError::ConnectionLost` (not a generic Protocol
    /// error) so the execution flow can offer the Reconectar CTA.
    #[tokio::test]
    async fn connect_with_disconnected_transport_returns_connection_lost() {
        let mut backend = Esp32Backend::new(Box::new(AlwaysDisconnected));
        let err = backend.connect().await.unwrap_err();
        assert_eq!(err, ControllerError::ConnectionLost);
    }

    /// R4-001: same contract for `execute` — the device dropping during
    /// upload/execute reports `ConnectionLost`, not `Protocol`.
    #[tokio::test]
    async fn execute_with_disconnected_transport_returns_connection_lost() {
        let mut backend = Esp32Backend::new(Box::new(DisconnectAfterHandshake::new()));
        backend.connect().await.expect("handshake should succeed");
        let err = backend
            .execute(vec![vec![0.0, 0.0], vec![1.0, 1.0]], 1.0)
            .await
            .unwrap_err();
        assert_eq!(err, ControllerError::ConnectionLost);
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
    fn execution_source_reports_hardware() {
        // The ESP32 is a real hardware execution backend — the UI badge must
        // reflect that, not the Simulation default (review fix R4-001).
        let transport = FakeTransport::new();
        let backend = Esp32Backend::new(Box::new(transport));
        assert_eq!(backend.execution_source(), ExecutionSource::Hardware);
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

    /// The deprecated `build_manifest` MUST delegate to the pure chain
    /// (`ExecutionManifestBuilder`) and reproduce the legacy even-spacing
    /// output bit-for-bit. A NON-divisible duration (2_000_000 µs / 3 gaps =
    /// 666_666 µs) pins the legacy integer-division semantics: `duration_us`
    /// is the SUM of `dt_us` (1_999_998), NOT `round(duration * 1e6)` — a
    /// naive wrapper that just forwards `duration` would produce 2_000_000.
    #[test]
    fn deprecated_build_manifest_delegates_to_builder() {
        let waypoints = vec![
            vec![0.0, 0.0],
            vec![0.5, 0.3],
            vec![1.0, 0.5],
            vec![1.5, 0.7],
        ];
        let duration = 2.0;

        // Legacy wrapper output.
        let legacy = Esp32Backend::build_manifest(&waypoints, duration);

        // The pure chain, fed the plan the wrapper constructs (same even
        // spacing reconstructed from the raw signature).
        let duration_us = (duration * 1_000_000.0) as u64;
        let dt_per_sample = duration_us / (waypoints.len() - 1) as u64;
        let plan = ExecutionPlan {
            waypoints: waypoints
                .iter()
                .enumerate()
                .map(|(i, joints)| ExecutionWaypoint {
                    joints: joints.clone(),
                    timestamp: i as f64 * dt_per_sample as f64 / 1_000_000.0,
                })
                .collect(),
            segments: vec![ExecutionSegment {
                index: 0,
                planned_segment_index: 0,
                instruction: ExecutionInstruction::MoveJ,
                waypoint_range: 0..waypoints.len(),
            }],
            duration: ((waypoints.len() as u64 - 1) * dt_per_sample) as f64 / 1_000_000.0,
        };
        let direct = ExecutionManifestBuilder::build(&plan).expect("same input must build");

        // Old and new paths produce IDENTICAL manifests.
        assert_eq!(legacy, direct);

        // And both preserve the legacy semantics exactly (integer division).
        assert_eq!(legacy.metadata.dof_count, 2);
        assert_eq!(legacy.metadata.total_samples, 4);
        assert_eq!(legacy.metadata.duration_us, 1_999_998);
        assert_eq!(legacy.segments.len(), 1);
        assert_eq!(legacy.segments[0].instruction, ManifestInstruction::MoveJ);
        assert_eq!(legacy.segments[0].sample_start, 0);
        assert_eq!(legacy.segments[0].sample_count, 4);
        let dt: Vec<u32> = legacy.samples.iter().map(|s| s.dt_us).collect();
        assert_eq!(dt, vec![0, 666_666, 666_666, 666_666]);
        assert_eq!(legacy.samples[3].joints, vec![1.5, 0.7]);
    }

    /// Regression test for the review-reliability CRITICAL on the deprecated
    /// shim: a duration shorter than (N-1) µs truncates `dt_per_sample` to
    /// zero, collapsing every reconstructed timestamp to 0.0. The builder's
    /// dedup then REJECTS the input (`DedupConflict` — equal timestamp,
    /// different joints), which would panic the `.expect()` inside the
    /// production `execute()` path, or silently collapse distinct commanded
    /// waypoints when joints are bit-equal. The shim MUST instead reproduce
    /// the legacy total output: N samples, all `dt_us = 0`, `duration_us = 0`,
    /// one MoveJ segment covering everything — accepted by the firmware
    /// validator (timing diff 0 <= 1000 µs floor).
    #[test]
    fn deprecated_build_manifest_handles_sub_microsecond_duration() {
        // 3 waypoints over 1.5 µs: trunc(1.5) = 1 µs / 2 gaps = 0 µs per sample.
        let waypoints = vec![vec![0.0, 0.0], vec![0.5, 0.3], vec![1.0, 0.5]];
        let duration = 1.5e-6;

        // Must NOT panic (the builder would return Err(DedupConflict) here).
        let manifest = Esp32Backend::build_manifest(&waypoints, duration);

        assert_eq!(manifest.metadata.dof_count, 2);
        assert_eq!(manifest.metadata.total_samples, 3);
        assert_eq!(manifest.metadata.duration_us, 0);

        assert_eq!(manifest.segments.len(), 1);
        assert_eq!(manifest.segments[0].index, 0);
        assert_eq!(manifest.segments[0].instruction, ManifestInstruction::MoveJ);
        assert_eq!(manifest.segments[0].sample_start, 0);
        assert_eq!(manifest.segments[0].sample_count, 3);

        assert_eq!(manifest.samples.len(), 3);
        let dt: Vec<u32> = manifest.samples.iter().map(|s| s.dt_us).collect();
        assert_eq!(dt, vec![0, 0, 0]);
        // Every sample retains its original commanded joints — nothing collapsed.
        for (sample, expected) in manifest.samples.iter().zip(&waypoints) {
            assert_eq!(sample.joints, *expected);
        }
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
