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
use crate::execution_boundary::safety_envelope::SafetyEnvelope;
use crate::execution_boundary::ExecutionSample;
use crate::session::execution_source::ExecutionSource;
use crate::state::robot_state::{MotionMode, RobotState};
use thalos_core::execution::plan::{
    ExecutionInstruction, ExecutionPlan, ExecutionSegment, ExecutionWaypoint,
};

use protocol::{Esp32Protocol, FirmwareState, ProtocolError};

/// ESP32 hardware backend.
///
/// Implements `RobotController` by delegating all wire communication to
/// `Esp32Protocol`. The protocol tracks firmware state and handles text
/// encoding/decoding.
///
/// Interior mutability: `robot_state(&self)` must poll STATUS and collect
/// samples through `&mut Esp32Protocol`, so the protocol lives behind a
/// `tokio::sync::Mutex`. Polled states are cached for a 75ms TTL so the UI's
/// ~60Hz tick loop does not hammer the wire.
pub struct Esp32Backend {
    protocol: tokio::sync::Mutex<Option<Esp32Protocol>>,
    connected: std::sync::atomic::AtomicBool,
    /// RES-02: consecutive `robot_state` poll failures — after 3 the
    /// connection is declared lost (`connected` cleared) so the next
    /// tick/snapshot surfaces a connection problem instead of freezing.
    consecutive_poll_failures: std::sync::atomic::AtomicU32,
    /// Total trajectory duration (seconds) of the current execution — set by
    /// `execute()`, reset on `disconnect()`. Used to convert the firmware's
    /// 0..1 progress fraction into SECONDS (R2.4/R2.5 pinned decision).
    plan_duration: f64,
    /// Throttled poll cache: last polled state + poll timestamp (75ms TTL).
    cached_state: tokio::sync::Mutex<Option<(std::time::Instant, Arc<RobotState>)>>,
    /// Samples collected on COMPLETED, consumed once by `take_execution_trace`.
    collected_samples: tokio::sync::Mutex<Option<Vec<ExecutionSample>>>,
    /// Last firmware status transition logged (0=idle/unknown, 1=RUNNING,
    /// 2=COMPLETED, 3=ERROR) — dedup so STATUS polls only log on change,
    /// giving an explicit `RUNNING → COMPLETED` trace in the logs (PR-0).
    last_status_logged: std::sync::atomic::AtomicU8,
}

impl Esp32Backend {
    /// Create a new `Esp32Backend` over the given transport.
    ///
    /// The transport is wrapped in an `Esp32Protocol` with the expected
    /// protocol version (currently 1). The handshake is not performed
    /// until `connect()` is called.
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self {
            protocol: tokio::sync::Mutex::new(Some(Esp32Protocol::new(transport, 1))),
            connected: std::sync::atomic::AtomicBool::new(false),
            consecutive_poll_failures: std::sync::atomic::AtomicU32::new(0),
            plan_duration: 0.0,
            cached_state: tokio::sync::Mutex::new(None),
            collected_samples: tokio::sync::Mutex::new(None),
            last_status_logged: std::sync::atomic::AtomicU8::new(0),
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
    /// # Errors
    ///
    /// Returns [`ControllerError::InvalidManifest`] if the pure builder
    /// rejects the input. R1-1 (CRITICAL): the builder now runs the firmware
    /// physical-envelope checks (`INVALID_JOINT` / `VELOCITY_EXCEEDED`) that
    /// the structural `validate_manifest` does not cover — a fast or
    /// out-of-envelope plan MUST surface as a graceful error (4xx at the
    /// API), NEVER a panic. Fail loud, reject-not-clamp.
    #[deprecated(note = "use ExecutionManifestBuilder via ExecutionPlanBuilder")]
    fn build_manifest(
        waypoints: &[Vec<f64>],
        duration: f64,
    ) -> Result<ExecutionManifest, ControllerError> {
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
        // joints), failing the Result below inside the production
        // `execute()` path, or silently collapses N distinct commanded
        // waypoints into one sample when joints are bit-equal. Legacy
        // behavior was total: an N-sample manifest with all `dt_us = 0`
        // (`duration_us` = 0) that the firmware validator accepts (timing
        // diff 0 <= 1000 µs floor). Bypass the builder and reproduce that
        // output exactly.
        //
        // M3 (ADR-3/ADR-5): this all-dt_us==0 output is NOT an instant-jump
        // plan. dt_us==0 makes physical velocity v = Δq/Δt UNDEFINED — the
        // manifest carries NO timing claim the executor could read as a jump.
        // Velocity-bounding is FIRMWARE-AUTHORITATIVE: the executor controls
        // advancement as max_velocity × elapsed_real_time and steps at most
        // one dt_us==0 waypoint per update (PROTOCOL SEMANTICS, documented in
        // docs/architecture/protocol/esp32-execution.md). The backend never infers host
        // velocity from Δq over a zero dt.
        if total_samples > 1 && dt_per_sample == 0 {
            return Ok(ExecutionManifest {
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
            });
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

        ExecutionManifestBuilder::build(&plan).map_err(|e| {
            // R1-1 (CRITICAL): the pure builder rejects plans the structural
            // `validate_manifest` passes — out-of-envelope positions
            // (INVALID_JOINT) and implied velocities above the firmware
            // ceilings (VELOCITY_EXCEEDED). The shim MUST NOT panic: surface
            // a graceful ControllerError so the API answers 4xx (invalid_manifest)
            // instead of the backend crashing. Fail loud, reject-not-clamp —
            // never silent clamp/mutation of the commanded plan.
            ControllerError::InvalidManifest(format!(
                "manifest rejected by the firmware-parity validator: {e}"
            ))
        })
    }

    /// Get a mutable reference to the protocol, if connected.
    ///
    /// `&mut self` callers use `tokio::sync::Mutex::get_mut` (no await needed);
    /// `&self` callers (`robot_state`, `take_execution_trace`) lock instead.
    fn protocol_mut(&mut self) -> Result<&mut Esp32Protocol, ControllerError> {
        self.protocol
            .get_mut()
            .as_mut()
            .ok_or(ControllerError::NotConnected)
    }

    /// Map a firmware state to a runtime [`RobotState`] — the single source
    /// of truth for the firmware → runtime mapping (design decision table).
    ///
    /// | Firmware | motion.mode | execution.progress | joints |
    /// |---|---|---|---|
    /// | IDLE / RECEIVING / READY | Idle | 0.0 | [] |
    /// | RUNNING (→ Executing) | Moving | fraction × plan_duration (SECONDS) | commanded |
    /// | COMPLETED | Idle | plan_duration, or 1.0 if < 1.0s | last commanded joints from cached RUNNING, else [] |
    /// | ERROR | EStop | 0.0 | [] |
    async fn map_firmware_state(&self, fs: &FirmwareState) -> RobotState {
        let mut state = RobotState::default();
        match fs {
            FirmwareState::Idle | FirmwareState::Receiving | FirmwareState::Ready => {
                state.motion.mode = MotionMode::Idle;
                state.execution.progress = 0.0;
            }
            FirmwareState::Executing { progress, joints } => {
                state.motion.mode = MotionMode::Moving;
                // R2.4/R2.5 (pinned): progress is SECONDS (fraction × plan_duration)
                // so the DTO mapper (current_time / plan_duration) yields the
                // correct 0..1 fraction on the wire.
                state.execution.progress = progress * self.plan_duration;
                state.joints.positions = joints.clone();
            }
            FirmwareState::Completed { .. } => {
                state.motion.mode = MotionMode::Idle;
                // COMPLETED → full progress. For plans ≥ 1s this is
                // plan_duration (seconds); short plans (< 1s) map to 1.0 so
                // completion detection (`progress >= 1.0`) still fires.
                state.execution.progress = if self.plan_duration >= 1.0 {
                    self.plan_duration
                } else {
                    1.0
                };
            }
            FirmwareState::Error(_) => {
                // ERROR → EStop so the existing `EStop → Failed` path in
                // session_from_robot_state works unchanged.
                state.motion.mode = MotionMode::EStop;
                state.execution.progress = 0.0;
            }
        }
        state
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

        // R1-1 (CRITICAL): surface the firmware physical-envelope rejection
        // HERE, before plan construction and any wire traffic — the firmware
        // SafetyEnvelope is authoritative for the live path. Position check
        // per waypoint; implied velocity Δq/Δt per gap over the SAME
        // even-spacing dt the shim reconstructs (bit-exact with the builder's
        // `round()`). The diagnostic code (INVALID_JOINT / VELOCITY_EXCEEDED)
        // matches `firmware/esp32/src/validator.cpp`. Reject-not-clamp: the
        // plan is refused unmodified, never silently clamped/mutated.
        for (i, w) in waypoints.iter().enumerate() {
            if let Err(v) = SafetyEnvelope::check_joints(w) {
                return Err(ControllerError::InvalidManifest(format!(
                    "plan rejected by the firmware safety envelope: {} ({}) at waypoint {i}",
                    v.diagnostic_code(),
                    v
                )));
            }
        }
        // dt == 0 gaps (sub-microsecond durations) make velocity UNDEFINED —
        // skipped, the firmware executor velocity-bounds advancement (ADR-3).
        if waypoints.len() > 1 {
            let duration_us = (duration * 1_000_000.0) as u64;
            let dt_per_gap_us = duration_us / (waypoints.len() - 1) as u64;
            if dt_per_gap_us > 0 {
                for i in 1..waypoints.len() {
                    let delta_q: Vec<f64> = waypoints[i]
                        .iter()
                        .zip(&waypoints[i - 1])
                        .map(|(a, b)| a - b)
                        .collect();
                    if let Err(v) =
                        SafetyEnvelope::check_gap_velocity(&delta_q, dt_per_gap_us as u32)
                    {
                        return Err(ControllerError::InvalidManifest(format!(
                            "plan rejected by the firmware safety envelope: {} ({}) at gap {}",
                            v.diagnostic_code(),
                            v,
                            i - 1
                        )));
                    }
                }
            }
        }
        Ok(())
    }
}

#[async_trait]
impl RobotController for Esp32Backend {
    async fn connect(&mut self) -> Result<(), ControllerError> {
        if self.is_connected() {
            return Err(ControllerError::AlreadyConnected);
        }

        let protocol = self.protocol_mut()?;

        protocol.handshake().await.map_err(|e| {
            let mapped = Self::map_protocol_error("handshake failed", e);
            tracing::error!(error = %mapped, "ESP32 handshake failed");
            mapped
        })?;

        self.connected
            .store(true, std::sync::atomic::Ordering::SeqCst);
        // RES-02: a fresh connection resets the poll-failure streak.
        self.consecutive_poll_failures
            .store(0, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("ESP32 connected (handshake OK)");
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), ControllerError> {
        self.connected
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.plan_duration = 0.0;
        // Stale poll cache / collected samples must not leak across connects.
        *self.cached_state.lock().await = None;
        *self.collected_samples.lock().await = None;
        self.last_status_logged
            .store(0, std::sync::atomic::Ordering::SeqCst);
        if let Some(protocol) = self.protocol.get_mut().as_mut() {
            let _ = protocol.stop().await;
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(std::sync::atomic::Ordering::SeqCst)
    }

    async fn execute(
        &mut self,
        waypoints: Vec<Vec<f64>>,
        duration: f64,
    ) -> Result<(), ControllerError> {
        if !self.is_connected() {
            return Err(ControllerError::NotConnected);
        }

        // Task 2.10: Validate manifest before any wire traffic
        Self::validate_manifest(&waypoints, duration).map_err(|e| {
            tracing::error!(
                error = %e,
                waypoints = waypoints.len(),
                duration_s = duration,
                "ESP32 execute rejected BEFORE wire traffic (invalid manifest)"
            );
            e
        })?;
        // Store the plan duration so STATUS polls can map fraction → seconds.
        self.plan_duration = duration;

        let protocol = self.protocol_mut()?;
        // The legacy shim is deprecated; execute() still consumes it until the
        // RobotController path migrates to the pure chain (separate SDD).
        // R1-1 (CRITICAL): the shim is FALLIBLE — the builder can reject a
        // plan the structural checks passed (INVALID_JOINT/VELOCITY_EXCEEDED),
        // and a rejection MUST surface as a graceful `InvalidManifest` error
        // (→ 4xx at the API), never a panic. No wire traffic has happened yet.
        #[allow(deprecated)]
        let manifest = Self::build_manifest(&waypoints, duration).map_err(|e| {
            tracing::error!(
                error = %e,
                waypoints = waypoints.len(),
                duration_s = duration,
                "ESP32 execute rejected by manifest builder (no wire traffic)"
            );
            e
        })?;

        // Upload → READY. One NOT_IDLE recovery: a stale firmware state
        // (READY/EXECUTING/ERROR left over from a previous session) rejects
        // MANIFEST — STOP resets the firmware to IDLE, then retry once.
        // Observed on real hardware after a failed connect left the device
        // in a non-IDLE state.
        let mut upload = protocol.upload_manifest(&manifest).await;
        if let Err(ProtocolError::EspError(reason)) = &upload {
            if reason.trim() == "NOT_IDLE" {
                tracing::warn!(reason = %reason, "manifest rejected NOT_IDLE — STOP-resetting the firmware and retrying");
                protocol.stop().await.ok(); // consumes its response; firmware → IDLE
                upload = protocol.upload_manifest(&manifest).await;
            }
        }
        upload
            .map_err(|e| {
                let mapped = Self::map_protocol_error("upload failed", e);
                tracing::error!(error = %mapped, waypoints = waypoints.len(), "ESP32 manifest upload failed");
                mapped
            })?;
        tracing::info!(
            waypoints = waypoints.len(),
            duration_s = duration,
            "ESP32 manifest uploaded (READY)"
        );

        // Execute → OK
        protocol.start_execution().await.map_err(|e| {
            let mapped = Self::map_protocol_error("execute failed", e);
            tracing::error!(error = %mapped, "ESP32 start_execution failed");
            mapped
        })?;
        tracing::info!("ESP32 execution started (EXECUTE OK)");

        // Return immediately per RobotController contract
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ControllerError> {
        if !self.is_connected() {
            return Err(ControllerError::NotConnected);
        }
        let protocol = self.protocol_mut()?;
        protocol
            .stop()
            .await
            .map_err(|e| Self::map_protocol_error("stop failed", e))?;
        Ok(())
    }

    /// Live state via a throttled STATUS poll (75ms TTL cache).
    ///
    /// Infallible: poll errors fall back to the cached state, else a default
    /// state. A not-connected backend returns a default state immediately.
    async fn robot_state(&self) -> Arc<RobotState> {
        const POLL_TTL: std::time::Duration = std::time::Duration::from_millis(75);

        // Cache hit within TTL → no wire traffic (UI ticks at ~60Hz).
        {
            let cached = self.cached_state.lock().await;
            if let Some((at, state)) = cached.as_ref() {
                if at.elapsed() < POLL_TTL {
                    return state.clone();
                }
            }
        }

        if !self.is_connected() {
            return Arc::new(RobotState::default());
        }

        let poll_result = {
            let mut guard = self.protocol.lock().await;
            match guard.as_mut() {
                Some(protocol) => protocol.query_status().await,
                None => {
                    return Arc::new(RobotState::default());
                }
            }
        };

        let state = match poll_result {
            Ok(fs) => {
                // A successful poll breaks the failure streak (RES-02).
                self.consecutive_poll_failures
                    .store(0, std::sync::atomic::Ordering::SeqCst);
                // Log firmware status TRANSITIONS (dedup) — the PR-0 evidence
                // of the RUNNING → COMPLETED cycle in the integration logs.
                let tag: u8 = match &fs {
                    FirmwareState::Executing { .. } => 1,
                    FirmwareState::Completed { .. } => 2,
                    FirmwareState::Error(_) => 3,
                    _ => 0,
                };
                if tag != 0 {
                    let prev = self
                        .last_status_logged
                        .swap(tag, std::sync::atomic::Ordering::SeqCst);
                    if prev != tag {
                        match tag {
                            1 => tracing::info!("firmware status: RUNNING"),
                            2 => tracing::info!("firmware status: COMPLETED"),
                            _ => tracing::info!("firmware status: ERROR"),
                        }
                    }
                }
                // On COMPLETED, collect the recorded samples (S3.5). Guard on
                // `sample_count > 0`: the firmware rejects `SAMPLES 0` as
                // MALFORMED (protocol.cpp), so the host must never send it.
                if let FirmwareState::Completed { sample_count } = &fs {
                    if *sample_count > 0 {
                        let mut guard = self.protocol.lock().await;
                        if let Some(protocol) = guard.as_mut() {
                            if let Ok(samples) =
                                protocol.collect_samples(*sample_count as usize).await
                            {
                                *self.collected_samples.lock().await = Some(samples);
                            }
                        }
                    }
                }

                let mut state = self.map_firmware_state(&fs).await;
                // COMPLETED: carry over the last commanded joints from the
                // previous cached RUNNING state, if any (design table: "last
                // commanded").
                if matches!(fs, FirmwareState::Completed { .. }) {
                    if let Some((_, cached)) = self.cached_state.lock().await.as_ref() {
                        state.joints.positions = cached.joints.positions.clone();
                    }
                }
                let state = Arc::new(state);
                *self.cached_state.lock().await = Some((std::time::Instant::now(), state.clone()));
                state
            }
            // Poll error (timeout / disconnected) → cached state, else default.
            // RES-02: after 3 CONSECUTIVE failures clear `connected` so the
            // next tick/snapshot surfaces a connection problem instead of a
            // frozen stale Running state; this call still serves the cache.
            Err(e) => {
                let failures = self
                    .consecutive_poll_failures
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                    + 1;
                tracing::debug!(error = %e, failures, "ESP32 STATUS poll failed");
                if failures >= 3 {
                    self.connected
                        .store(false, std::sync::atomic::Ordering::SeqCst);
                    tracing::warn!("ESP32 marked disconnected after 3 consecutive poll failures");
                }
                let cached = self.cached_state.lock().await;
                match cached.as_ref() {
                    Some((_, state)) => state.clone(),
                    None => Arc::new(RobotState::default()),
                }
            }
        };

        state
    }

    /// Take the collected execution samples (SAMPLES) exactly once.
    ///
    /// The scene service drains this after completion detection; `mem::take`
    /// clears the buffer so a subsequent call returns `None`.
    async fn take_execution_trace(&self) -> Option<Vec<ExecutionSample>> {
        let mut guard = self.collected_samples.lock().await;
        std::mem::take(&mut *guard)
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
    pub async fn test_sent_commands(&self) -> Vec<Vec<u8>> {
        let guard = self.protocol.lock().await;
        guard
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
    pub async fn test_inject_response(&self, data: Vec<u8>) {
        let guard = self.protocol.lock().await;
        if let Some(protocol) = guard.as_ref() {
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
    use crate::execution_boundary::safety_envelope::SafetyEnvelope;
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
            .lock()
            .await
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

    /// RES-02 (RED): N consecutive poll failures must clear `connected` so
    /// the next tick/snapshot surfaces a connection problem instead of
    /// serving the stale cached state (or default) forever with the session
    /// stuck Running.
    #[tokio::test]
    async fn consecutive_poll_failures_clear_connected() {
        let mut backend = Esp32Backend::new(Box::new(DisconnectAfterHandshake::new()));
        backend.connect().await.expect("handshake succeeds");
        assert!(backend.is_connected());

        // Each poll sleeps past the 75ms cache TTL so it actually hits the wire.
        for _ in 0..3 {
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
            let _ = backend.robot_state().await;
        }
        assert!(
            !backend.is_connected(),
            "3 consecutive poll failures must clear connected"
        );
    }

    // ── Task 2.5: RED — full upload→execute→collect cycle ────────────

    #[tokio::test]
    async fn full_cycle_with_fake_transport() {
        let transport = FakeTransport::new();
        let mut backend = make_connected_backend(transport).await;

        // Inject responses for the full upload→execute flow
        backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // MANIFEST
        backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // SEGMENT
        backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // SAMPLE 0
        backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_inject_response(b"OK\n".to_vec()); // SAMPLE 1
        backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_inject_response(b"READY\n".to_vec()); // END_UPLOAD
        backend
            .protocol
            .lock()
            .await
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
        let sent = backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_sent_commands();
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
            .lock()
            .await
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
            .lock()
            .await
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
        let sent = backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_sent_commands();
        assert_eq!(sent.len(), 1, "only HELLO should have been sent");
        assert_eq!(String::from_utf8(sent[0].clone()).unwrap(), "HELLO 1\n");
    }

    #[tokio::test]
    async fn zero_duration_rejected_before_wire_traffic() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));
        backend
            .protocol
            .lock()
            .await
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
                .lock()
                .await
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
            .lock()
            .await
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
                .lock()
                .await
                .as_ref()
                .unwrap()
                .test_sent_commands()
                .len(),
            1
        );
    }

    // ── R1-1 (CRITICAL review finding): out-of-envelope plans MUST be ──
    // ── rejected gracefully by execute() — NEVER panic.               ──

    /// R1-1 (CRITICAL, deterministic): P2 added INVALID_JOINT/
    /// VELOCITY_EXCEEDED checks to `ExecutionManifestBuilder::validate`, but
    /// `execute()`'s deprecated `build_manifest` shim `.expect()` PANICKED
    /// when the pure builder rejected the plan — a DoS on the live
    /// start-execution path. A movej whose implied velocity exceeds the
    /// firmware SAFETY_ENVELOPE ceiling (base 1.0 rad over 0.2 s =
    /// 5.0 rad/s > 1.0 rad/s) passes the API planner (PhysicalEnvelope
    /// ceiling 25 rad/s) and previously crashed the backend. It MUST now
    /// surface as `ControllerError::InvalidManifest` (→ HTTP 400
    /// `invalid_manifest`) with the VELOCITY_EXCEEDED diagnostic — fail
    /// loud, reject-not-clamp, no wire traffic.
    #[tokio::test]
    async fn execute_rejects_out_of_envelope_velocity_without_panic() {
        let transport = FakeTransport::new();
        let mut backend = make_connected_backend(transport).await;

        // Base 1.0 rad over 0.2 s = 5.0 rad/s implied velocity — inside the
        // planner envelope (25 rad/s), outside the firmware envelope (1.0).
        let result = backend
            .execute(vec![vec![0.0, 0.0], vec![1.0, 0.0]], 0.2)
            .await;

        match result {
            Ok(()) => panic!("out-of-envelope velocity plan must be rejected, not executed"),
            Err(ControllerError::InvalidManifest(msg)) => {
                assert!(
                    msg.contains("VELOCITY_EXCEEDED"),
                    "rejection must name the VELOCITY_EXCEEDED diagnostic: {msg}"
                );
            }
            Err(other) => panic!("expected InvalidManifest, got {other:?}"),
        }

        // Rejected BEFORE wire traffic: still connected, only the HELLO from
        // connect was sent.
        assert!(backend.is_connected());
        let sent = backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_sent_commands();
        assert_eq!(sent.len(), 1, "only HELLO from connect — no upload traffic");
        assert_eq!(String::from_utf8(sent[0].clone()).unwrap(), "HELLO 1\n");
    }

    /// R1-1 (CRITICAL): an out-of-envelope POSITION plan (base at 4.0 rad —
    /// outside the firmware ±1.5708 rad envelope) previously PANICKED the
    /// shim's `.expect()` (INVALID_JOINT). It MUST now be rejected
    /// gracefully with the INVALID_JOINT diagnostic — never clamped, never
    /// executed, no wire traffic.
    #[tokio::test]
    async fn execute_rejects_out_of_envelope_position_without_panic() {
        let transport = FakeTransport::new();
        let mut backend = make_connected_backend(transport).await;

        // Base 4.0 rad — the planner accepts it (URDF planning envelope),
        // the firmware SafetyEnvelope rejects it.
        let result = backend
            .execute(vec![vec![0.0, 0.0], vec![4.0, 0.0]], 1.0)
            .await;

        match result {
            Ok(()) => panic!("out-of-envelope position plan must be rejected, not executed"),
            Err(ControllerError::InvalidManifest(msg)) => {
                assert!(
                    msg.contains("INVALID_JOINT"),
                    "rejection must name the INVALID_JOINT diagnostic: {msg}"
                );
            }
            Err(other) => panic!("expected InvalidManifest, got {other:?}"),
        }

        assert!(backend.is_connected());
        let sent = backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_sent_commands();
        assert_eq!(sent.len(), 1, "only HELLO from connect — no upload traffic");
    }

    // ── Additional backend tests ─────────────────────────────────────

    #[tokio::test]
    async fn disconnect_sends_stop_and_clears_connected() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));
        backend
            .protocol
            .lock()
            .await
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
        let manifest = Esp32Backend::build_manifest(&waypoints, 2.0)
            .expect("in-envelope waypoints must build");

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
        let legacy = Esp32Backend::build_manifest(&waypoints, duration)
            .expect("in-envelope waypoints must build");

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
        let manifest = Esp32Backend::build_manifest(&waypoints, duration)
            .expect("sub-microsecond duration must take the degenerate branch");

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

    /// M3 no-instant-jump contract (spec `backend_dt_us_zero_velocity_bounded`,
    /// ADR-3/ADR-5): the degenerate all-dt_us==0 branch MUST NOT produce a plan
    /// the executor could read as an instant jump. The manifest carries NO
    /// Δq/Δt timing claim (every dt_us == 0, duration_us == 0) — physical
    /// velocity is UNDEFINED, so the firmware executor velocity-bounds
    /// advancement (max_velocity × elapsed real time, one waypoint per
    /// update). The backend never emits a fabricated dt that implies a jump.
    #[test]
    fn degenerate_zero_dt_manifest_has_no_instant_jump_timing_claim() {
        // 4 distinct commanded joints over a sub-microsecond duration.
        let waypoints = vec![
            vec![0.0, 0.0, 0.0, 0.01],
            vec![0.5, 0.5, 0.5, 0.02],
            vec![1.0, 1.0, 1.0, 0.03],
        ];
        let manifest = Esp32Backend::build_manifest(&waypoints, 1.5e-6)
            .expect("sub-microsecond duration must take the degenerate branch");

        // Every gap is dt_us == 0: no sample pair carries an implied Δq/Δt.
        assert_eq!(manifest.metadata.duration_us, 0, "no duration claim");
        for (i, sample) in manifest.samples.iter().enumerate() {
            assert_eq!(
                sample.dt_us, 0,
                "sample {i} must not fabricate a timing claim (instant-jump read)"
            );
        }
        // All commanded joints preserved — the firmware velocity-bounds each
        // waypoint in turn; nothing is collapsed or re-timed by the backend.
        for (sample, expected) in manifest.samples.iter().zip(&waypoints) {
            assert_eq!(sample.joints, *expected);
        }
        // And the mirror's velocity check treats dt==0 as UNDEFINED (skipped):
        // the same manifest passes the backend's physical validation.
        for pair in manifest.samples.windows(2) {
            let delta_q: Vec<f64> = pair[1]
                .joints
                .iter()
                .zip(&pair[0].joints)
                .map(|(a, b)| a - b)
                .collect();
            SafetyEnvelope::check_gap_velocity(&delta_q, pair[1].dt_us)
                .expect("dt==0 velocity must be skipped (firmware-authoritative)");
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

    /// Robustness regression (real hardware): a stale serial buffer (boot
    /// bytes / leftover from a previous session) can make the first HELLO
    /// read return garbage. The handshake retries once and succeeds.
    #[tokio::test]
    async fn handshake_survives_stale_buffer_line() {
        let transport = FakeTransport::new();
        let mut backend = Esp32Backend::new(Box::new(transport));
        // First read → stale garbage (observed: "0.000000 0.000000");
        // retry read → the real handshake response.
        backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_inject_response(b"0.000000 0.000000\n".to_vec());
        backend
            .protocol
            .lock()
            .await
            .as_ref()
            .unwrap()
            .test_inject_response(b"HELLO 1 OK\n".to_vec());

        backend
            .connect()
            .await
            .expect("handshake retry must recover from a stale buffer line");
        assert!(backend.is_connected());
    }

    /// Robustness regression (real hardware): a stale firmware state
    /// (READY/EXECUTING/ERROR from a previous session) rejects MANIFEST with
    /// NOT_IDLE. The backend STOP-resets the device (→ IDLE) and retries the
    /// upload once — no manual device reset needed.
    #[tokio::test]
    async fn upload_recovers_from_not_idle_with_stop_and_retry() {
        let transport = FakeTransport::new();
        let mut backend = make_connected_backend(transport).await;
        {
            let protocol = backend.protocol.lock().await;
            let p = protocol.as_ref().unwrap();
            // First upload: MANIFEST rejected because the firmware is not IDLE.
            p.test_inject_response(b"ERROR NOT_IDLE\n".to_vec());
            // Recovery STOP response (consumed by protocol.stop()).
            p.test_inject_response(b"OK\n".to_vec());
            // Retry upload: MANIFEST, SEGMENT, SAMPLE 0, SAMPLE 1, END_UPLOAD.
            p.test_inject_response(b"OK\n".to_vec());
            p.test_inject_response(b"OK\n".to_vec());
            p.test_inject_response(b"OK\n".to_vec());
            p.test_inject_response(b"OK\n".to_vec());
            p.test_inject_response(b"READY\n".to_vec());
            // EXECUTE.
            p.test_inject_response(b"OK\n".to_vec());
        }

        backend
            .execute(vec![vec![0.0, 0.0], vec![1.0, 1.0]], 1.0)
            .await
            .expect("upload must recover from NOT_IDLE with a STOP + retry");
        assert!(backend.is_connected());
    }
}
