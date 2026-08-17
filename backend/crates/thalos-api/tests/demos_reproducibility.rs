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

use axum::http::StatusCode;

use thalos_api::evidence::{print_evidence, run_demo};

async fn test_app() -> axum::Router {
    let state = thalos_api::new_default_state().await;
    thalos_api::app_router().with_state(state)
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
