//! Integration test: PlanCompiler → Esp32Backend pipeline.
//!
//! Valida los contratos entre `thalos-planning` y `thalos-runtime`:
//!
//! ```text
//! PlanningProgram
//!     ↓
//! PlanCompiler          (thalos-planning)
//!     ↓
//! CompiledPlan
//!     ↓ extract waypoints + duration
//! Esp32Backend          (thalos-runtime)
//!     ↓
//! FakeTransport
//! ```
//!
//! # ¿Qué verifica?
//!
//! - El `PlanningProgram` compila sin errores con un robot real (Planar2R).
//! - El `CompiledPlan` preserva la cantidad de segmentos y waypoints.
//! - Los waypoints extraídos pasan a `Esp32Backend::execute()` sin error.
//! - El backend envía los comandos wire esperados (MANIFEST, SEGMENT, SAMPLE, EXECUTE).
//! - La conexión permanece activa después de la ejecución.
//!
//! # ¿Qué NO verifica?
//!
//! - Algoritmos internos de planificación (ya tienen 124+ tests).
//! - El protocolo línea por línea (ya tiene 32 tests dedicados).
//! - Hardware real (usa `FakeTransport`).

use thalos_core::{
    ids::OperationId,
    kinematics::inverse::{IKGoal, IKResult, IKSolver, IkError},
    models::{RobotModel, RobotRegistry},
    motion::segment::MotionSegment,
    robot::{serial_chain::SerialChain, state::RobotState},
};
use thalos_planning::motion::{
    compiler::{DefaultPlannerDispatcher, PlanCompiler},
    planner::SegmentPlanningContext,
    program::PlanningProgram,
};
use thalos_runtime::{
    backends::{esp32::Esp32Backend, transport::FakeTransport},
    ControllerError, RobotController,
};

// ---------------------------------------------------------------------------
// Noop IK solver — necesario para el SegmentPlanningContext aunque los tests
// usen solo MoveJ (que no necesita IK). MoveL requeriría un solver real.
// ---------------------------------------------------------------------------
struct NoopIKSolver;

impl IKSolver for NoopIKSolver {
    fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
        Ok(IKResult::converged(q0.to_vec(), 1, 0.0, None))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_planar2r_context() -> (SerialChain, SegmentPlanningContext<'static>) {
    // HACK: SerialChain is owned but ctx borrows it. We leak to get 'static.
    // Safe because the chain lives for the test duration.
    let chain = Box::new(RobotRegistry::create_default(RobotModel::Planar2R));
    let chain_ref: &'static SerialChain = Box::leak(chain);

    let state = RobotState::zero(chain_ref.dof_count());
    let state_ref: &'static RobotState = Box::leak(Box::new(state));

    let ik = Box::new(NoopIKSolver);
    let ik_ref: &'static dyn IKSolver = Box::leak(ik);

    let ctx = SegmentPlanningContext {
        robot: chain_ref,
        current_state: state_ref,
        ik_solver: ik_ref,
        tcp: None,
    };

    (chain_ref.clone(), ctx)
}

fn compile_movej_program(
    compiler: &PlanCompiler,
    targets: Vec<Vec<f64>>,
    ctx: &SegmentPlanningContext<'_>,
) -> thalos_planning::motion::program::CompiledPlan {
    let segments: Vec<MotionSegment> = targets
        .into_iter()
        .map(|target| MotionSegment::MoveJ {
            origin: OperationId("test".to_string()),
            target,
            max_velocity: None,
            max_acceleration: None,
        })
        .collect();

    let program = PlanningProgram::new(segments);
    compiler
        .compile(&program, ctx)
        .expect("PlanCompiler::compile should succeed")
}

/// Crea un FakeTransport con respuestas pre-cargadas para:
///   1. HELLO handshake (1 respuesta)
///   2. Upload: MANIFEST + SEGMENT + N×SAMPLE + END_UPLOAD (N+2 respuestas OK + 1 READY)
///   3. EXECUTE (1 respuesta OK)
fn transport_with_responses(sample_count: usize) -> FakeTransport {
    let t = FakeTransport::new();

    // 1. HELLO handshake
    t.inject_response(b"HELLO 1 OK\n".to_vec());

    // 2. Upload: OK for MANIFEST, SEGMENT, each SAMPLE
    for _ in 0..sample_count + 2 {
        t.inject_response(b"OK\n".to_vec());
    }
    // END_UPLOAD → READY
    t.inject_response(b"READY\n".to_vec());

    // 3. EXECUTE → OK
    t.inject_response(b"OK\n".to_vec());

    t
}

// =========================================================================
// TESTS
// =========================================================================

/// Pipeline completo: planificación → ejecución simulada.
///
/// Crea un `PlanningProgram` con 2 segmentos MoveJ, lo compila con el
/// `PlanCompiler` sobre un robot Planar2R, extrae los waypoints, y los
/// ejecuta sobre un `Esp32Backend` con `FakeTransport`.
#[tokio::test]
async fn plan_compile_then_esp32_execute() {
    // ── 1. Setup ────────────────────────────────────────────────────────
    let (_chain, ctx) = build_planar2r_context();
    let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));

    // ── 2. Compile ──────────────────────────────────────────────────────
    // M3 contract correction: the first target's elbow is 0.3 (the pre-M3
    // −0.3 is out of the firmware elbow envelope [0, 2.0944] — the backend
    // now applies the firmware physical checks to compiled plans).
    let plan = compile_movej_program(&compiler, vec![vec![0.5, 0.3], vec![1.0, 0.8]], &ctx);

    // Verify compilation integrity
    assert!(
        plan.waypoint_count > 0,
        "compiled plan should produce waypoints"
    );
    assert_eq!(plan.segments.len(), 2, "should preserve segment count");
    assert!(
        plan.duration > 0.0,
        "compiled plan should have finite duration"
    );

    let waypoints: Vec<Vec<f64>> = plan
        .merged_trajectory
        .waypoints()
        .iter()
        .map(|wp| wp.joints().to_vec())
        .collect();

    assert_eq!(waypoints.len(), plan.waypoint_count);
    assert_eq!(
        waypoints[0],
        vec![0.0, 0.0],
        "first waypoint must match start state (zero)"
    );
    assert_eq!(
        waypoints[waypoints.len() - 1],
        vec![1.0, 0.8],
        "last waypoint must match final target"
    );

    // ── 3. Execute ──────────────────────────────────────────────────────
    let transport = transport_with_responses(waypoints.len());
    let mut backend = Esp32Backend::new(Box::new(transport));

    backend
        .connect()
        .await
        .expect("Esp32Backend should connect via FakeTransport");
    assert!(
        backend.is_connected(),
        "should be connected after handshake"
    );

    backend
        .execute(waypoints.clone(), plan.duration)
        .await
        .expect("Esp32Backend should execute compiled plan");
    assert!(
        backend.is_connected(),
        "should remain connected after execute"
    );

    // ── 4. Verify wire commands ────────────────────────────────────────
    let sent = backend.test_sent_commands().await;
    assert!(!sent.is_empty(), "commands should have been sent");

    let as_text: Vec<String> = sent
        .iter()
        .map(|b| String::from_utf8_lossy(b).to_string())
        .collect();

    // HELLO is always first (from connect)
    let hello_line: &String = &as_text[0];
    assert_eq!(
        hello_line.trim(),
        "HELLO 1",
        "first command should be HELLO"
    );

    // MANIFEST was sent with correct DOF and sample count
    let manifest_line: Option<&String> =
        as_text.iter().find(|l: &&String| l.starts_with("MANIFEST"));
    assert!(manifest_line.is_some(), "MANIFEST should have been sent");
    if let Some(ml) = manifest_line {
        let trimmed: &str = ml.as_str().trim();
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        assert_eq!(parts[0], "MANIFEST");
        assert_eq!(parts[1], "2", "DOF should be 2 for Planar2R");
        assert_eq!(
            parts[2],
            waypoints.len().to_string(),
            "sample count should match"
        );
    }

    // All waypoints were sent as SAMPLE lines
    let sample_count: usize = as_text
        .iter()
        .filter(|l: &&String| l.starts_with("SAMPLE"))
        .count();
    assert_eq!(
        sample_count,
        waypoints.len(),
        "every waypoint should produce a SAMPLE command"
    );

    // END_UPLOAD and EXECUTE were sent
    let has_end_upload: bool = as_text.iter().any(|l: &String| l.starts_with("END_UPLOAD"));
    assert!(has_end_upload, "END_UPLOAD should have been sent");
    let has_execute: bool = as_text.iter().any(|l: &String| l.starts_with("EXECUTE"));
    assert!(has_execute, "EXECUTE should have been sent");

    // ── 5. Cleanup ─────────────────────────────────────────────────────
    backend.stop().await.expect("stop should succeed");
}

/// R1-1 (CRITICAL review finding): a movej at 5.0 rad/s COMPILES (the
/// planner's PhysicalEnvelope ceiling is ~25 rad/s — ~25× the firmware
/// SAFETY_ENVELOPE 1.0 rad/s) and passes the API, but the firmware envelope
/// rejects it. `Esp32Backend::execute()` must reject it GRACEFULLY
/// (`ControllerError::InvalidManifest` → HTTP 400 `invalid_manifest`, spec
/// `backend_manifest_out_of_envelope_must_be_rejected`) — the pre-fix code
/// PANICKED via the deprecated `build_manifest` shim's `.expect()`
/// (VELOCITY_EXCEEDED), a DoS on the live start-execution path.
#[tokio::test]
async fn fast_movej_compiles_but_execute_rejects_gracefully() {
    let (_chain, ctx) = build_planar2r_context();
    let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));

    // MoveJ at 5.0 rad/s, accel 50 rad/s² (so the short 1.0 rad move reaches
    // cruise velocity instead of a sub-1.0 rad/s triangular peak). The
    // planner accepts it; the firmware envelope (1.0 rad/s) does not.
    let segments: Vec<MotionSegment> = vec![MotionSegment::MoveJ {
        origin: OperationId("test".to_string()),
        target: vec![1.0, 0.8],
        max_velocity: Some(5.0),
        max_acceleration: Some(50.0),
    }];
    let program = PlanningProgram::new(segments);
    let plan = compiler
        .compile(&program, &ctx)
        .expect("5 rad/s movej must compile (planner ceiling is 25 rad/s)");

    let waypoints: Vec<Vec<f64>> = plan
        .merged_trajectory
        .waypoints()
        .iter()
        .map(|wp| wp.joints().to_vec())
        .collect();
    assert!(
        waypoints.len() >= 2,
        "fast movej should produce a multi-waypoint trajectory"
    );

    let transport = transport_with_responses(waypoints.len());
    let mut backend = Esp32Backend::new(Box::new(transport));
    backend.connect().await.expect("connect should succeed");

    // Pre-fix this PANICKED (shim `.expect()` on VELOCITY_EXCEEDED).
    let result = backend.execute(waypoints, plan.duration).await;
    match result {
        Ok(()) => panic!("fast movej must be rejected, not executed"),
        Err(ControllerError::InvalidManifest(msg)) => {
            assert!(
                msg.contains("VELOCITY_EXCEEDED"),
                "rejection must name the VELOCITY_EXCEEDED diagnostic: {msg}"
            );
        }
        Err(other) => panic!("expected InvalidManifest, got {other:?}"),
    }
}

/// Compilación de programa vacío → Esp32Backend recibe error de validación.
#[tokio::test]
async fn empty_plan_compile_ok_but_execute_fails() {
    let (_chain, ctx) = build_planar2r_context();
    let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));

    // Compile empty program — compila Ok (no waypoints, no duration)
    let program = PlanningProgram::new(vec![]);
    let plan = compiler
        .compile(&program, &ctx)
        .expect("empty program compiles to empty plan");
    assert_eq!(plan.waypoint_count, 0);
    assert_eq!(plan.duration, 0.0);

    // Execute with no waypoints — Esp32Backend rejection
    let transport = transport_with_responses(0);
    let mut backend = Esp32Backend::new(Box::new(transport));
    backend.connect().await.expect("connect should succeed");

    let result: Result<(), _> = backend.execute(vec![], 0.0).await;
    assert!(
        result.is_err(),
        "Esp32Backend should reject empty waypoints"
    );
}

/// Compilación de múltiples segmentos → preserves DOF y continuidad.
#[tokio::test]
async fn multi_segment_compile_preserves_continuity() {
    let (_chain, ctx) = build_planar2r_context();
    let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));

    // Three consecutive MoveJ segments
    let plan = compile_movej_program(
        &compiler,
        vec![vec![0.5, 0.0], vec![0.5, 0.5], vec![-0.3, 0.8]],
        &ctx,
    );

    assert_eq!(plan.segments.len(), 3);
    assert!(
        plan.waypoint_count >= 3,
        "should have at least one waypoint per segment"
    );

    let waypoints = plan.merged_trajectory.waypoints();

    // Verificar continuidad: el último waypoint de cada segmento debe
    // ser el primer waypoint del siguiente (shared boundary state).
    for i in 0..plan.segments.len() - 1 {
        let seg = &plan.segments[i];
        let next_seg = &plan.segments[i + 1];

        let seg_end = &waypoints[seg.waypoint_range.end - 1];
        let next_start = &waypoints[next_seg.waypoint_range.start];

        assert_eq!(
            seg_end.joints(),
            next_start.joints(),
            "segment {} end must match segment {} start (continuity)",
            i,
            i + 1
        );
    }

    // Verify all waypoints have correct DOF
    for wp in waypoints {
        assert_eq!(wp.joints().len(), 2, "all waypoints must have 2 DOF");
    }
}

/// Compilación → ejecución preserve DOF consistency.
#[tokio::test]
async fn dof_consistency_across_pipeline() {
    let (_chain, ctx) = build_planar2r_context();
    let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));

    let plan = compile_movej_program(&compiler, vec![vec![1.0, 0.5]], &ctx);

    let waypoints: Vec<Vec<f64>> = plan
        .merged_trajectory
        .waypoints()
        .iter()
        .map(|wp| wp.joints().to_vec())
        .collect();

    // All waypoints should have consistent DOF = 2 (Planar2R)
    for (i, wp) in waypoints.iter().enumerate() {
        assert_eq!(
            wp.len(),
            2,
            "waypoint {} should have 2 joints for Planar2R",
            i
        );
    }

    // Verificar que `build_manifest` acepta estos waypoints sin error
    // (es un método estático, lo llamamos indirectamente via execute)
    let transport = transport_with_responses(waypoints.len());
    let mut backend = Esp32Backend::new(Box::new(transport));
    backend.connect().await.expect("connect should succeed");

    backend
        .execute(waypoints, plan.duration)
        .await
        .expect("execute with correct DOF should succeed");
}
