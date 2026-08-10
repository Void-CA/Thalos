//! End-to-end host ↔ simulator integration tests.
//!
//! Drives the REAL `Esp32Backend` over a REAL `TcpTransport` against the
//! in-process `esp-simulator` (the wire-verification instrument from
//! `examples/esp-simulator.rs`, included below via `#[path]`). Unlike
//! `tests/esp32_integration.rs` (scripted `FakeTransport` responses), every
//! byte here crosses a real TCP socket through the simulator's state machine.
//!
//! Covers the three deterministic scenarios end-to-end:
//!   - `happy`:   upload → execute → RUNNING ramp → COMPLETED → collectable
//!                6-DOF execution trace.
//!   - `error`:   upload → execute → `STATUS ERROR` → mapped to `EStop`.
//!   - `silence`: upload → execute → device goes deaf → receive timeouts →
//!                3 consecutive failures drop the connection → `NotConnected`.
//!
//! Plus a protocol-level out-of-order rejection (`EXECUTE` without a manifest
//! must be refused with `NOT_READY`).

#[path = "../examples/esp-simulator.rs"]
mod esp_simulator;

use std::time::Duration;

use thalos_runtime::{
    ControllerError, RobotController,
    backends::{
        esp32::{
            protocol::{Esp32Protocol, ProtocolError},
            Esp32Backend,
        },
        transport::{TcpTransport, Transport},
    },
    state::robot_state::{MotionMode, RobotState},
};

use esp_simulator::{Scenario, SimConfig, SimServer};

/// Interval between `robot_state()` polls — strictly greater than the
/// backend's 75ms poll TTL so every call triggers a fresh STATUS round-trip
/// on the wire instead of serving the cache.
const POLL_INTERVAL: Duration = Duration::from_millis(80);
/// Upper bound for any scenario, so CI can never hang on a bug.
const SCENARIO_TIMEOUT: Duration = Duration::from_secs(10);

/// Plan duration used by every execute(): 2.0s → 2_000_000 µs on the wire,
/// so the simulator's recorded trace has a deterministic 200ms step.
const PLAN_DURATION: f64 = 2.0;
/// Number of samples the default `happy` run records (`SimConfig::default`).
const DEFAULT_SAMPLE_COUNT: usize = 10;
/// µs between recorded samples: `duration_us / samples` = 2_000_000 / 10.
const SAMPLE_STEP_US: u64 = 200_000;

/// A 3-waypoint, 6-DOF plan (joints in radians). All waypoints share the
/// same DOF so the manifest is valid and every collected sample has 6 joints.
fn six_dof_waypoints() -> Vec<Vec<f64>> {
    vec![
        vec![0.0, 0.1, 0.2, -0.1, 0.3, 0.05],
        vec![0.2, 0.15, 0.4, 0.1, 0.1, 0.2],
        vec![0.5, 0.3, 0.1, 0.4, 0.6, 0.0],
    ]
}

/// Start an in-process simulator for the given scenario on an ephemeral port
/// and return the server handle + the bound address.
fn start_sim(scenario: Scenario) -> (SimServer, String) {
    let server = esp_simulator::start_listener(
        "127.0.0.1:0",
        SimConfig {
            scenario,
            ..SimConfig::default()
        },
    )
    .expect("simulator must bind");
    let addr = server.addr().to_string();
    (server, addr)
}

/// Connect the REAL host backend to the in-process simulator: TCP socket,
/// then the HELLO handshake.
async fn connect_backend(addr: &str) -> Esp32Backend {
    let mut transport = TcpTransport::new(addr);
    transport.connect().await.expect("TCP connect to simulator");
    let mut backend = Esp32Backend::new(Box::new(transport));
    backend
        .connect()
        .await
        .expect("HELLO handshake against the simulator must succeed");
    assert!(backend.is_connected(), "backend must report connected");
    backend
}

/// Poll `robot_state()` (sleeping past the 75ms TTL between polls) until
/// `pred` holds or `SCENARIO_TIMEOUT` elapses.
async fn poll_until(backend: &Esp32Backend, mut pred: impl FnMut(&RobotState) -> bool) {
    tokio::time::timeout(SCENARIO_TIMEOUT, async {
        loop {
            let state = backend.robot_state().await;
            if pred(&state) {
                return;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .expect("timed out waiting for the backend to reach the expected state");
}

// ── happy: full cycle + 6-DOF execution trace ─────────────────────────────

#[tokio::test]
async fn happy_cycle_completes_and_collects_six_dof_trace() {
    let (mut server, addr) = start_sim(Scenario::Happy);
    let mut backend = connect_backend(&addr).await;

    backend
        .execute(six_dof_waypoints(), PLAN_DURATION)
        .await
        .expect("execute must succeed on the happy device");

    // Drive STATUS polls until the firmware COMPLETED → backend Idle with
    // full progress (12 polls at 80ms ≈ 1s, well under the 10s timeout).
    poll_until(&backend, |s| {
        s.motion.mode == MotionMode::Idle && s.execution.progress >= PLAN_DURATION
    })
    .await;

    assert!(
        backend.is_connected(),
        "the happy device must stay connected after completion"
    );

    // `SAMPLES 10` was collected on COMPLETED: the default run records 10
    // samples, each ts-first with all 6 joints, deterministic timestamps.
    let trace = backend
        .take_execution_trace()
        .await
        .expect("execution trace must be available after completion");
    assert_eq!(trace.len(), DEFAULT_SAMPLE_COUNT, "default run records 10 samples");
    for (i, sample) in trace.iter().enumerate() {
        assert_eq!(sample.joints.len(), 6, "sample {i} must carry 6 joints");
        assert_eq!(
            sample.timestamp_us,
            i as u64 * SAMPLE_STEP_US,
            "sample {i} timestamp must be ts-first and monotonic"
        );
        assert!(
            i == 0 || sample.timestamp_us > trace[i - 1].timestamp_us,
            "sample {i} timestamp must strictly increase"
        );
    }

    // The trace is consumed exactly once (clear-on-collect).
    assert!(
        backend.take_execution_trace().await.is_none(),
        "take_execution_trace must return None after collection"
    );

    backend.disconnect().await.expect("disconnect must succeed");
    server.stop();
}

// ── error: STATUS ERROR → EStop ───────────────────────────────────────────

#[tokio::test]
async fn error_scenario_ends_in_estop() {
    let (mut server, addr) = start_sim(Scenario::Error);
    let mut backend = connect_backend(&addr).await;

    backend
        .execute(six_dof_waypoints(), PLAN_DURATION)
        .await
        .expect("execute must succeed before the device faults");

    // Two RUNNING polls, then STATUS ERROR MOTOR_STALL → mapped to EStop.
    poll_until(&backend, |s| s.motion.mode == MotionMode::EStop).await;

    let state = backend.robot_state().await;
    assert_eq!(state.motion.mode, MotionMode::EStop, "ERROR must map to EStop");
    assert_eq!(
        state.execution.progress, 0.0,
        "EStop must report zero progress"
    );

    // EStop is a firmware state, NOT a dropped connection.
    assert!(
        backend.is_connected(),
        "a firmware error must not drop the connection"
    );

    backend.disconnect().await.expect("disconnect must succeed");
    server.stop();
}

// ── silence: deaf device → 3 failures → NotConnected ──────────────────────

#[tokio::test]
async fn silence_drops_connection_and_subsequent_ops_fail() {
    let (mut server, addr) = start_sim(Scenario::Silence);
    let mut backend = connect_backend(&addr).await;

    backend
        .execute(six_dof_waypoints(), PLAN_DURATION)
        .await
        .expect("execute must be ACKed before the device goes deaf");

    // Every STATUS poll times out (500ms receive timeout). RES-02: after 3
    // CONSECUTIVE failures the backend clears `connected`. ~3 × 0.6s ≈ 1.8s.
    tokio::time::timeout(SCENARIO_TIMEOUT, async {
        while backend.is_connected() {
            let _ = backend.robot_state().await;
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .expect("the silence scenario must drop the connection after 3 failed polls");

    assert!(
        !backend.is_connected(),
        "3 consecutive poll failures must clear the connected flag"
    );

    // `robot_state` on a not-connected backend returns the default state.
    let state = backend.robot_state().await;
    assert_eq!(state.motion.mode, MotionMode::Idle, "default state is Idle");
    assert_eq!(state.execution.progress, 0.0, "default state has no progress");

    // Subsequent operations must fail fast with NotConnected.
    let err = backend
        .execute(six_dof_waypoints(), PLAN_DURATION)
        .await
        .unwrap_err();
    assert!(
        matches!(err, ControllerError::NotConnected),
        "execute after silence must fail with NotConnected, got {err:?}"
    );
    let err = backend.stop().await.unwrap_err();
    assert!(
        matches!(err, ControllerError::NotConnected),
        "stop after silence must fail with NotConnected, got {err:?}"
    );

    // Close the (still-open) socket so the simulator's connection thread ends.
    backend.disconnect().await.expect("disconnect must succeed");
    server.stop();
}

// ── protocol: out-of-order EXECUTE rejected with NOT_READY ────────────────

#[tokio::test]
async fn execute_without_manifest_is_rejected_not_ready() {
    let (mut server, addr) = start_sim(Scenario::Happy);
    let mut transport = TcpTransport::new(&addr);
    transport.connect().await.expect("TCP connect to simulator");
    let mut protocol = Esp32Protocol::new(Box::new(transport), 1);
    protocol
        .handshake()
        .await
        .expect("HELLO handshake must succeed");

    // Fire EXECUTE without an upload: the device is in IDLE and must refuse
    // the out-of-order command with the NOT_READY wire error.
    let err = protocol
        .start_execution()
        .await
        .expect_err("EXECUTE without a manifest must be rejected");
    match err {
        ProtocolError::EspError(reason) => {
            assert_eq!(reason, "NOT_READY", "device must report NOT_READY");
        }
        other => panic!("expected EspError(NOT_READY), got {other:?}"),
    }

    // Dropping the protocol closes the socket; stop the accept loop.
    drop(protocol);
    server.stop();
}

// ── execution-mode-repeat (R10, NF2): 3 sequential uploads, single trace ────

/// R10/NF2: re-upload per iteration requires ZERO firmware changes — a
/// Repeat { count: 3 } host loop issues three full manifest uploads against
/// the SAME connected device, and the host collects exactly ONE execution
/// trace (the last run's 10 samples, clear-on-take).
#[tokio::test]
async fn repeat_three_uploads_thrice_and_collects_single_trace() {
    let (mut server, addr) = start_sim(Scenario::Happy);
    let mut backend = connect_backend(&addr).await;

    for _i in 0..3 {
        backend
            .execute(six_dof_waypoints(), PLAN_DURATION)
            .await
            .expect("each iteration uploads and starts execution");
        // Sleep past the 75ms STATUS-poll TTL BEFORE the first poll: the
        // previous iteration left a terminal state (Idle, progress=plan) in
        // the cache — an immediate poll would short-circuit on that stale
        // "completed" and skip waiting for THIS iteration to actually run.
        tokio::time::sleep(POLL_INTERVAL).await;
        // Drive STATUS polls until the firmware COMPLETED → Idle with full
        // progress (same predicate as the happy-cycle test).
        poll_until(&backend, |s| {
            s.motion.mode == MotionMode::Idle && s.execution.progress >= PLAN_DURATION
        })
        .await;
    }

    // R10: 3 iterations = 3 full upload+execute cycles on the SAME device.
    // The loop above already proves the wire contract: each `execute()` does a
    // complete MANIFEST→…→END_UPLOAD→READY→EXECUTE upload, and any broken
    // re-upload path would have failed an iteration with NOT_READY instead of
    // completing. (The `test_sent_commands()` wire-count helper is
    // FakeTransport-only — calling it on a TcpTransport-backed backend is UB.)

    // Single trace: the LAST run's 10 samples, consumed exactly once.
    let trace = backend
        .take_execution_trace()
        .await
        .expect("execution trace must be available after the final iteration");
    assert_eq!(trace.len(), DEFAULT_SAMPLE_COUNT, "single trace with 10 samples");
    assert!(
        backend.take_execution_trace().await.is_none(),
        "trace is clear-on-take: a second call must return None"
    );

    assert!(
        backend.is_connected(),
        "the device stays connected across repeated uploads"
    );
    backend.disconnect().await.expect("disconnect must succeed");
    server.stop();
}
