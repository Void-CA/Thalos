//! Slice 5a — Demo reproducibility + behavioral predicates (design testing
//! strategy; spec `icebot-showcase` "Reproducibility from Source Artifacts").
//!
//! Each canonical demo under the repo-root `demos/` (the default
//! `THALOS_DEMOS_ROOT`, D9) must be reproducible from its persisted source
//! artifacts alone — no pre-generated pipeline artifacts (spec). The test:
//!
//!   1. loads icebot (`robot.name = "icebot"`, D11),
//!   2. fetches scene.json + program.thalos through the CATALOG authority
//!      (D10 — never direct filesystem paths),
//!   3. parses both source files (SceneFile → SceneContent; DSL text →
//!      SemanticProgram via `thalos_semantic::script::parse`),
//!   4. derives the demo home joints from the scene's `home_pose` (bent seed
//!      home — Slice 0 finding 1: FK(0) is full extension → singular DLS),
//!   5. runs the real pipeline (compile → execute → analyze) and asserts each
//!      demo's BEHAVIORAL PREDICATE — never exact poses or risk numbers
//!      (recalibration-resilient). Evidence is printed for the READMEs.

use axum::{
    Router,
    body::Body,
    http::{self, Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

use thalos_document::scene_file::SceneFile;
use thalos_semantic::script;

const ICEBOT_URDF: &str = include_str!("../../../../docs/execution/robot/icebot.urdf");

/// Repo `demos/` root — the default `THALOS_DEMOS_ROOT` (`./demos`, D9):
/// `demos/index.json` is the catalog authority (D10).
const DEMOS_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../demos");

/// `THALOS_DEMOS_ROOT` is process-global — the demos tests serialize on a
/// mutex (same pattern as api_tests.rs) so env changes never race.
static DEMOS_ROOT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

async fn test_app() -> Router {
    let state = thalos_api::new_default_state().await;
    thalos_api::app_router().with_state(state)
}

async fn get_json(
    router: Router,
    method: http::Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Option<Value>) {
    let req = Request::builder().method(method).uri(path);
    let req = if let Some(b) = body {
        req.header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&b).unwrap()))
            .unwrap()
    } else {
        req.body(Body::empty()).unwrap()
    };
    let resp = router.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).ok())
}

/// Fetch a text/plain body (the program.thalos endpoint).
async fn get_text(router: Router, path: &str) -> (StatusCode, String) {
    let req = Request::builder().method(http::Method::GET).uri(path)
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&bytes).to_string())
}

/// Wire evidence of one demo run: execute + analyze outcomes.
struct DemoEvidence {
    demo_id: &'static str,
    execute_status: StatusCode,
    execute_body: Option<Value>,
    segment_count: Option<u64>,
    analyze_status: StatusCode,
    /// `candidate_ranking` object when the pipeline produced one.
    ranking: Option<Value>,
}

/// Closed-form bent start for icebot's 2-link arm (L1 = 0.125, L2 = 0.100,
/// axis_1 limit [0, 2.0944]) derived from the scene's `home_pose` — the ONLY
/// robot state the scene file carries. Icebot's `from-urdf` initial state is
/// FK(0) = full extension, a singular DLS start (Slice 0 finding 1), so the
/// runtime must first be parked at a bent configuration before the IK solver
/// can converge to the home. q2 = −(q0+q1) matches the identity home
/// orientation; q3 = 0.04 − z inverts the prismatic + fixed-TCP chain.
fn bent_start_joints(home: &thalos_document::pose::Pose) -> [f64; 4] {
    const L1: f64 = 0.125;
    const L2: f64 = 0.100;
    let [x, y, z] = home.position;
    let r = (x * x + y * y).sqrt();
    let q0 = y.atan2(x);
    let cos_q1 = ((r * r - L1 * L1 - L2 * L2) / (2.0 * L1 * L2)).clamp(-1.0, 1.0);
    let q1 = cos_q1.acos();
    let q2 = -(q0 + q1);
    let q3 = (0.04 - z).clamp(0.0, 0.06);
    [q0, q1, q2, q3]
}

/// Run one demo through the REAL pipeline:
/// catalog → scene + program → derive home → compile → execute → analyze.
async fn run_demo(app: &Router, demo_id: &'static str) -> DemoEvidence {
    let _guard = DEMOS_ROOT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: serialized by DEMOS_ROOT_LOCK — only demos tests mutate
    // THALOS_DEMOS_ROOT, each holding the lock across set_var + requests.
    unsafe { std::env::set_var("THALOS_DEMOS_ROOT", DEMOS_ROOT) };

    // 1. Load icebot — the demo robot (D11: stable name "icebot").
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({ "urdf_source": ICEBOT_URDF })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "icebot must load");

    // 2. Fetch the demo artifacts via the CATALOG authority (D10).
    let (status, body) = get_json(app.clone(), http::Method::GET, "/api/v1/demos", None).await;
    assert_eq!(status, StatusCode::OK, "catalog must be servable");
    let catalog = body.expect("catalog must be JSON");
    let entry = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == demo_id)
        .unwrap_or_else(|| panic!("demo {demo_id} must be listed in the catalog"));
    assert!(
        entry["category"].as_str().is_some(),
        "catalog entries must carry presentation metadata (title/category)"
    );

    let (status, scene_body) = get_json(
        app.clone(),
        http::Method::GET,
        &format!("/api/v1/demos/{demo_id}/scene"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "scene must be servable for {demo_id}");
    let (status, program_text) = get_text(
        app.clone(),
        &format!("/api/v1/demos/{demo_id}/program"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "program must be servable for {demo_id}");

    // 3. Parse the persisted source artifacts (reproducibility: files alone).
    let scene_file: SceneFile = serde_json::from_value(scene_body.expect("scene must be JSON"))
        .expect("scene.json must parse as a SceneFile v1");
    let scene = scene_file.clone().into_scene_content();
    let program = script::parse(&program_text)
        .unwrap_or_else(|e| panic!("program.thalos must parse for {demo_id}: {e:?}"));

    // 4. Derive the demo home joints from scene.json's `home_pose` (nothing
    //    beyond the source files): park the runtime at a bent non-singular
    //    start, warm-start IK to the exact home, then set the home joints.
    let hp = &scene.home_pose;
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/joints",
        Some(json!({ "joint_angles": bent_start_joints(hp) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "runtime must park at a bent start");

    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/solve-ik-pose",
        Some(json!({
            "target": {
                "translation": hp.position,
                "rotation": { "kind": "Quaternion", "value": {
                    "w": hp.orientation[3],
                    "x": hp.orientation[0],
                    "y": hp.orientation[1],
                    "z": hp.orientation[2],
                } }
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "IK must run on the demo home pose");
    let body = body.expect("ik response must be JSON");
    assert_eq!(body["ik_result"]["status"], "Converged", "the demo home must be reachable");
    let joints: Vec<f64> = body["joints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/joints",
        Some(json!({ "joint_angles": joints })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "runtime must start at the demo home");

    // 5. Compile + execute (scene → semantic → compile → plan → schedule).
    let (execute_status, execute_body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/semantic/execute",
        Some(json!({
            "task": {
                "id": demo_id,
                "metadata": {
                    "name": demo_id,
                    "version": 1,
                    "created_at": "2026-08-14T00:00:00Z",
                    "modified_at": "2026-08-14T00:00:00Z",
                },
                "scene": serde_json::to_value(&scene).unwrap(),
                "program": serde_json::to_value(&program).unwrap(),
            }
        })),
    )
    .await;

    // 6. Analyze the active plan (only meaningful when one was scheduled).
    let (analyze_status, analyze_body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/analyze",
        Some(json!({})),
    )
    .await;

    let segment_count = execute_body
        .as_ref()
        .and_then(|b| b.get("segment_count"))
        .and_then(|v| v.as_u64());
    let ranking = analyze_body
        .as_ref()
        .and_then(|b| b.get("candidate_ranking"))
        .cloned();

    DemoEvidence {
        demo_id,
        execute_status,
        execute_body,
        segment_count,
        analyze_status,
        ranking,
    }
}

/// Print the observed evidence (reference for the READMEs — NOT asserted).
fn print_evidence(evidence: &DemoEvidence) {
    eprintln!("[{}]", evidence.demo_id);
    eprintln!(
        "  execute {:?} segment_count {:?}",
        evidence.execute_status, evidence.segment_count
    );
    if let Some(body) = &evidence.execute_body {
        if body.get("error").is_some() {
            eprintln!("  execute body: {}", body);
        }
    }
    eprintln!("  analyze {:?}", evidence.analyze_status);
    if let Some(ranking) = &evidence.ranking {
        let selected = ranking["selected"].as_str().unwrap_or("(none)");
        let reason = ranking["reason"]["kind"].as_str().unwrap_or("?");
        eprintln!("  selected: {selected} (reason: {reason})");
        if let Some(ranked) = ranking["ranked"].as_array() {
            for row in ranked {
                eprintln!(
                    "    {:<16} risk {:<8} duration {:<8} manip {:<8} cost {}",
                    row["strategy"].as_str().unwrap_or("?"),
                    row["risk"],
                    row["duration"],
                    row["manipulability"],
                    row["cost"]
                );
            }
        }
    }
}

// ── Behavioral predicates (design fixture-design-intent table) ──────────────

#[tokio::test]
async fn happy_path_selects_direct_and_executes() {
    let app = test_app().await;
    let evidence = run_demo(&app, "happy-path").await;
    print_evidence(&evidence);

    // admissible = true: the pipeline executes the full task.
    assert_eq!(evidence.execute_status, StatusCode::OK, "happy-path must execute");
    assert!(
        evidence.segment_count.unwrap_or(0) >= 6,
        "pick + place + home must plan real segments, got {:?}",
        evidence.segment_count
    );
    assert_eq!(evidence.analyze_status, StatusCode::OK, "happy-path must analyze");
    // Predicate restoration (spec icebot-showcase "Direct selected, executes,
    // ≥6 segments, ranking present"): with the ε deadband in
    // `normalize_min_max`, the degenerate AlternateElbow copy ties Direct on
    // every component (sub-ε duration delta 1.38e-5 s < 1e-4), so the stable
    // sort selects Direct — the first candidate in the original order
    // (spec candidate-evaluation "Deadband tie — deterministic selection").
    let ranking = evidence
        .ranking
        .expect("the pipeline must produce an admissible ranking for happy-path");
    let selected = ranking["selected"]
        .as_str()
        .expect("an admissible realization must be selected");
    assert_eq!(
        selected, "Direct",
        "the deadband tie-break must select Direct (first in candidate order), got {selected}"
    );
    let ranked = ranking["ranked"]
        .as_array()
        .expect("ranked must be an array");
    assert!(
        !ranked.is_empty(),
        "the ranking must carry the scored candidates"
    );
    assert!(
        ranked.iter().any(|row| row["strategy"] == "Direct"),
        "the Direct realization must be admissible (ranked), got {:?}",
        ranked
    );
}

#[tokio::test]
async fn multi_object_executes_all_operations_in_sequence() {
    let app = test_app().await;
    let evidence = run_demo(&app, "multi-object").await;
    print_evidence(&evidence);

    // admissible = true: every pick/place operation compiles and runs.
    assert_eq!(evidence.execute_status, StatusCode::OK, "multi-object must execute");
    assert!(
        evidence.segment_count.unwrap_or(0) >= 12,
        "two pick/place pairs plus home must plan a real composition, got {:?}",
        evidence.segment_count
    );
    assert_eq!(evidence.analyze_status, StatusCode::OK, "multi-object must analyze");
}

#[tokio::test]
async fn repair_alternatives_surfaces_alternatives() {
    let app = test_app().await;
    let evidence = run_demo(&app, "repair-alternatives").await;
    print_evidence(&evidence);

    // admissible = true: the risky Direct path still compiles/executes.
    assert_eq!(
        evidence.execute_status, StatusCode::OK,
        "the constrained carry must still execute, got {:?}: {:?}",
        evidence.execute_status, evidence.execute_body
    );
    assert_eq!(evidence.analyze_status, StatusCode::OK, "repair demo must analyze");
    // Predicate redefinition (spec icebot-showcase "repair-alternatives"):
    // the demo's story is "alternatives surfaced", not "better path chosen".
    // The pipeline generates + scores alternatives (≥2 admissible, Direct
    // admissible, AlternateElbow Generated), but on icebot the risk floor
    // (0.625) means no realization is measurably better — the alternate is a
    // sub-ε copy, so Direct wins the deterministic tie-break.
    let ranking = evidence
        .ranking
        .expect("the risky carry must produce a candidate ranking");
    let ranked = ranking["ranked"]
        .as_array()
        .expect("ranked must be an array");
    assert!(
        ranked.len() >= 2,
        "the pipeline must surface ≥2 admissible candidates, got {:?}",
        ranked
    );
    assert!(
        ranked.iter().any(|row| row["strategy"] == "Direct"),
        "Direct must be admissible (ranked), got {:?}",
        ranked
    );
    let trace = ranking["strategy_trace"]
        .as_array()
        .expect("strategy_trace must be an array");
    assert!(
        trace.iter().any(|row| {
            row["strategy"] == "AlternateElbow" && row["outcome"]["kind"] == "generated"
        }),
        "the pipeline must have attempted repair (AlternateElbow Generated), got {:?}",
        trace
    );
}

#[tokio::test]
async fn safety_rejection_blocks_execution() {
    let app = test_app().await;
    let evidence = run_demo(&app, "safety-rejection").await;
    print_evidence(&evidence);

    // admissible = false: the target sits outside the workspace envelope, so
    // the pipeline BLOCKS (observed UX) — never a silent pass.
    assert_ne!(
        evidence.execute_status, StatusCode::OK,
        "an unreachable target must NOT silently execute: {:?}",
        evidence.execute_body
    );
    assert_eq!(
        evidence.execute_status, StatusCode::UNPROCESSABLE_ENTITY,
        "the pipeline must refuse execution with 422 (BLOCKED), got {:?}",
        evidence.execute_status
    );
    let body = evidence.execute_body.expect("blocked response must be JSON");
    assert_eq!(
        body["code"], "planning_error",
        "the block must be a planning failure (unreachable target), got {:?}",
        body
    );
    assert!(
        evidence.segment_count.is_none(),
        "a blocked demo schedules no plan"
    );
}

