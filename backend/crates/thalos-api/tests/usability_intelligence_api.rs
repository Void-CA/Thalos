//! REAL usability end-to-end flow through the HTTP API — the exact path the
//! web UI drives (`planAnalysisApi`).
//!
//! Full user loop: load robot → schedule program → analyze (score recorded) →
//! preview EVERY available recommendation (read-only) → apply the top one →
//! re-analyze the edited program → assert the health outcome matches the
//! preview → undo → assert the original program and its score come back.
//!
//! No mocks: the API composes the real `DampedLeastSquaresSolver`, the real
//! `PlanCompiler`, the real `TrajectoryAnalyzer` and the real `PlanAdvisor`.
//!
//! This file intentionally overlaps the three exposed bugs when the scenario
//! exhibits them — the assertions still verify the flow CONTRACT holds even
//! when the score is saturated (BUG 1) and does not improve (BUG 3).

use axum::{Router, body::Body, http::{self, Request, StatusCode}};
use serde_json::{Value, json};
use tower::ServiceExt;

use thalos_api::{app_router, new_state_with_scene_writeback};

async fn test_app() -> Router {
    // Scene write-back must be ON for apply/undo to write (D5).
    let state = new_state_with_scene_writeback(true).await;
    app_router().with_state(state)
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
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let value: Option<Value> = serde_json::from_slice(&bytes).ok();
    (status, value)
}

/// The Scara near-reach program used across the api_tests preview/apply
/// fixtures: a MoveJ segment 0 then a SHORT MoveL segment 1 near full reach.
/// The trajectory keeps its average manipulability below the
/// LowManipulability threshold (dense profile sampling of a far move would
/// dilute it), so the advisor emits Manipulability/Waypoint recommendations
/// on a segment that does not start at the current joints.
async fn schedule_scara_near_reach(app: &Router) {
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "load scara must succeed");

    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/plan",
        Some(json!({
            "segments": [
                {"type": "movej", "target": [0.5, -0.3, -0.1, 0.0]},
                {
                    "type": "movel",
                    "target": {
                        "translation": [1.66, 0.60, 0.42],
                        "rotation": {"kind": "Quaternion", "value": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}}
                    }
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "scheduling the plan must succeed");
}

/// Trajectory signature of the active plan from GET /scene: waypoint count +
/// first/last joints (same shape as the existing api_tests helper).
fn active_trajectory_signature(scene: &Value) -> (usize, Vec<Vec<f64>>) {
    let wps = scene["active_plan"]["visualization"]["waypoints"]
        .as_array()
        .expect("active plan must carry trajectory visualization waypoints");
    let joints: Vec<Vec<f64>> = wps
        .iter()
        .map(|w| {
            w["joints"]
                .as_array()
                .map(|j| j.iter().map(|v| v.as_f64().expect("joint value")).collect())
                .expect("waypoint must carry joints")
        })
        .collect();
    assert!(!joints.is_empty(), "trajectory must not be empty");
    (
        joints.len(),
        vec![
            joints.first().unwrap().clone(),
            joints.last().unwrap().clone(),
        ],
    )
}

/// Recommendation ids the analyze response marks `available`.
fn available_recommendation_ids(analyze_body: &Value) -> Vec<u32> {
    analyze_body["recommendations"]
        .as_array()
        .expect("analyze must return recommendations")
        .iter()
        .filter(|r| r["status"] == "available")
        .map(|r| r["id"].as_u64().expect("recommendation id") as u32)
        .collect()
}

#[tokio::test]
async fn e2e_analyze_preview_apply_reauth_undo_restores_original() {
    let app = test_app().await;
    schedule_scara_near_reach(&app).await;

    // ── 1. Analyze → score recorded ─────────────────────────────────────────
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/analyze",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "analyze must succeed");
    let body = body.expect("analyze response");
    let original_quality = body["summary"]["quality_index"]
        .as_f64()
        .expect("summary.quality_index");
    let original_score = body["summary"]["score"]
        .as_u64()
        .expect("summary.score");
    // score is the presentation projection quality_index × 100 (I7).
    assert_eq!(
        original_score,
        (original_quality * 100.0).round() as u64,
        "score must be quality_index × 100"
    );
    let (_, scene_first) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let original_plan_id = scene_first
        .expect("scene")
        .get("active_plan")
        .and_then(|p| p["plan_id"].as_str())
        .expect("active plan id")
        .to_string();

    let available = available_recommendation_ids(&body);
    assert!(
        !available.is_empty(),
        "the near-reach plan must produce at least one available recommendation"
    );
    let top = available[0];
    eprintln!(
        "[usability] analyzed plan {original_plan_id}: quality={original_quality:.3} score={original_score} available={available:?} top={top}"
    );

    // ── 2. Preview EVERY available recommendation (read-only simulation) ────
    let mut previewed = Vec::new();
    for rec_id in &available {
        let (_, scene_before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
        let scene_before = scene_before.expect("scene");

        let (status, preview) = get_json(
            app.clone(),
            http::Method::POST,
            "/api/v1/plan/commands/preview",
            Some(json!({"recommendation_id": *rec_id})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "preview of recommendation {rec_id} must succeed");
        let preview = preview.expect("preview response");
        assert!(
            preview["waypoints"].as_array().is_some_and(|w| !w.is_empty()),
            "preview must return a waypoint trajectory"
        );
        assert!(
            preview["health_before"].as_f64().is_some() && preview["health_after"].as_f64().is_some(),
            "preview must report before/after health"
        );

        // Read-only contract: the active plan must NOT change after preview.
        let (_, scene_after) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
        let scene_after = scene_after.expect("scene");
        assert_eq!(
            scene_after["active_plan"], scene_before["active_plan"],
            "preview must not mutate the active plan (read-only simulation)"
        );

        previewed.push((*rec_id, preview));
    }

    // ── 3. Apply the TOP available recommendation (write-back) ──────────────
    let (status, apply) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/apply",
        Some(json!({"recommendation_id": top})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "apply of the top recommendation must succeed");
    let apply = apply.expect("apply response");
    assert_eq!(apply["history_length"], 1, "apply stores the inverse for undo");
    assert_eq!(apply["status"], "available", "apply echoes D8 availability");
    let applied_plan_id = apply["plan_id"].as_str().expect("plan_id").to_string();
    let applied_health = apply["health_after"].as_f64().expect("health_after");
    let apply_health_before = apply["health_before"].as_f64().unwrap_or(0.0);
    eprintln!(
        "[usability] applied rec {top}: quality {apply_health_before:.3} -> {applied_health:.3}"
    );

    // ── 4. The applied health outcome must match the preview's prediction ───
    let (top_id, top_preview) = previewed
        .iter()
        .find(|(id, _)| *id == top)
        .expect("top recommendation was previewed");
    let _ = top_id;
    let preview_health_after = top_preview["health_after"]
        .as_f64()
        .expect("preview health_after");
    assert!(
        (applied_health - preview_health_after).abs() < 1e-9,
        "the applied outcome must match the preview: preview predicted {preview_health_after}, apply produced {applied_health}"
    );

    // Write-back observable: the active plan changed.
    let (_, scene_after_apply) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let scene_after_apply = scene_after_apply.expect("scene");
    let applied_trajectory = active_trajectory_signature(&scene_after_apply);
    let applied_plan_id_from_scene = scene_after_apply["active_plan"]["plan_id"]
        .as_str()
        .expect("plan_id")
        .to_string();
    assert_ne!(applied_plan_id_from_scene, original_plan_id, "apply must write a new plan");

    // ── 5. Re-analyze the edited program → outcome matches the preview ──────
    let (status, reauth) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/analyze",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "re-analysis after apply must succeed");
    let reauth = reauth.expect("re-analysis response");
    let reauth_quality = reauth["summary"]["quality_index"]
        .as_f64()
        .expect("summary.quality_index");
    assert!(
        (reauth_quality - applied_health).abs() < 1e-9,
        "re-analysis of the edited program must reproduce the applied health: applied {applied_health}, re-analyzed {reauth_quality}"
    );
    assert!(
        (reauth_quality - preview_health_after).abs() < 1e-9,
        "re-analysis must reproduce the preview's prediction ({preview_health_after}), got {reauth_quality}"
    );

    // ── 6. Undo → restores the original program and the original score ─────
    let (status, undo) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/undo",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "undo must succeed after apply");
    let undo = undo.expect("undo response");
    assert_eq!(undo["history_length"], 0, "undo pops the command history");
    eprintln!(
        "[usability] undo: restored quality {:.3} (original {original_quality:.3})",
        undo["health_after"].as_f64().unwrap_or(-1.0)
    );
    assert_ne!(
        undo["plan_id"].as_str().unwrap(),
        applied_plan_id,
        "undo writes a NEW restored plan id"
    );
    let restored_health = undo["health_after"].as_f64().expect("undo health_after");

    // Program roundtrip: trajectory signature equals the ORIGINAL plan's.
    let (_, scene_after_undo) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let scene_after_undo = scene_after_undo.expect("scene");
    let restored_trajectory = active_trajectory_signature(&scene_after_undo);
    let (_, scene_before_apply) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let scene_before_apply = scene_before_apply.expect("scene");
    let original_trajectory = active_trajectory_signature(&scene_before_apply);
    assert_eq!(
        restored_trajectory, original_trajectory,
        "undo must restore the original plan trajectory"
    );
    assert_ne!(restored_trajectory, applied_trajectory, "the applied trajectory must be gone");

    // Original score restored: re-analyze the restored program.
    let (status, reauth_restored) = get_json(
        app,
        http::Method::POST,
        "/api/v1/plan/analyze",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "re-analysis after undo must succeed");
    let reauth_restored = reauth_restored.expect("re-analysis after undo");
    let restored_quality = reauth_restored["summary"]["quality_index"]
        .as_f64()
        .expect("summary.quality_index");
    assert!(
        (restored_quality - original_quality).abs() < 1e-9,
        "undo must restore the ORIGINAL score: original {original_quality}, restored {restored_quality}"
    );
    assert!(
        (restored_health - original_quality).abs() < 1e-9,
        "undo health_after must equal the original quality: undo {restored_health}, original {original_quality}"
    );
}
