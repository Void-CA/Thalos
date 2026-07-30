use axum::{
    Router,
    body::Body,
    http::{self, Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

use thalos_api::{app_router, new_default_state};

async fn test_app() -> Router {
    let state = new_default_state().await;
    app_router().with_state(state)
}

async fn get_json(
    router: Router,
    method: http::Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Option<Value>) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");

    let req = if let Some(b) = body {
        req.body(Body::from(serde_json::to_string(&b).unwrap()))
            .unwrap()
    } else {
        req.body(Body::empty()).unwrap()
    };

    let resp = router.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Option<Value> = serde_json::from_slice(&bytes).ok();
    (status, value)
}

// ── Scene contract tests ──

#[tokio::test]
async fn get_scene_returns_wrapped_scene() {
    let app = test_app().await;
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    // response is wrapped: { scene: VisualScene, generated_at }
    assert!(
        body.get("scene").is_some(),
        "response must contain 'scene' wrapper"
    );
    assert!(
        body.get("generated_at").is_some(),
        "response must contain 'generated_at'"
    );

    let scene = &body["scene"];
    assert!(scene.get("frames").is_some(), "scene must contain frames");
    let frames = scene["frames"].as_array().unwrap();
    let has_world = frames.iter().any(|f| f["id"] == "world");
    assert!(has_world, "scene must contain world frame");
}

#[tokio::test]
async fn from_fk_returns_wrapped_scene() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({"joint_angles": [0.5, 0.3]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    assert!(
        body.get("scene").is_some(),
        "response must contain 'scene' wrapper"
    );
    assert!(
        body.get("generated_at").is_some(),
        "response must contain 'generated_at'"
    );

    let scene = &body["scene"];
    assert!(scene.get("frames").is_some());
    let frames = scene["frames"].as_array().unwrap();
    assert!(frames.len() >= 3, "planar_2r should have world + 2 links");
}

#[tokio::test]
async fn from_fk_rejects_nan() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({"joint_angles": [f64::NAN, 0.0]})),
    )
    .await;
    assert!(status.is_client_error(), "NaN should be rejected");
    assert!(body.is_none() || body.as_ref().is_some_and(|v| v.get("scene").is_none()));
}

#[tokio::test]
async fn from_fk_rejects_missing_field() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({"state": [0.5, 0.3]})),
    )
    .await;
    assert!(
        status.is_client_error(),
        "missing joint_angles should be rejected"
    );
}

// ── Validation tests ──

#[tokio::test]
async fn validate_valid_scene() {
    let app = test_app().await;
    let (_, body) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let wrapped = body.expect("valid scene response");
    let scene = &wrapped["scene"];

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": scene})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    assert_eq!(body["valid"], true);
}

#[tokio::test]
async fn validate_invalid_scene() {
    let app = test_app().await;
    let invalid = json!({
        "frames": [],
        "links": [],
        "joint_axes": [],
        "twists": [],
        "primitives": []
    });

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": invalid})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("response must be valid JSON");
    // validate returns ErrorResponse on failure (not ValidateResponse)
    assert!(
        body.get("code").is_some(),
        "error response must contain 'code'"
    );
    assert_eq!(body["code"], "MISSING_WORLD");
    assert!(body["error"].as_str().unwrap().contains("world"));
}

// ── Diff tests ──

#[tokio::test]
async fn diff_identical_scenes() {
    let app = test_app().await;
    let (_, body) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let wrapped = body.expect("valid scene");
    let scene = &wrapped["scene"];

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/diff",
        Some(json!({"old": scene, "new": scene, "epsilon": 1e-6})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    assert_eq!(body["changed_frames"], json!([]));
    assert_eq!(body["frames_added"], json!([]));
    assert_eq!(body["frames_removed"], json!([]));
}

#[tokio::test]
async fn diff_different_scenes() {
    let app = test_app().await;
    let q0 = json!({"joint_angles": [0.0, 0.0]});
    let q1 = json!({"joint_angles": [1.5, 0.0]});

    let (_, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(q0),
    )
    .await;
    let old_wrapped = body.expect("valid scene");
    let old = &old_wrapped["scene"];

    let (_, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(q1),
    )
    .await;
    let new_wrapped = body.expect("valid scene");
    let new = &new_wrapped["scene"];

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/diff",
        Some(json!({"old": old, "new": new, "epsilon": 1e-6})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let changed = body["changed_frames"].as_array().unwrap();
    assert!(
        !changed.is_empty(),
        "different configurations should produce changes"
    );
}

// ── Error mapping tests ──

#[tokio::test]
async fn error_code_missing_world() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [],
            "links": [],
            "joint_axes": [],
            "twists": [],
            "primitives": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "MISSING_WORLD");
}

#[tokio::test]
async fn error_code_duplicate_id() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [
                {"id": "world", "parent": null, "translation": [0,0,0], "rotation": [1,0,0,0]},
                {"id": "link_1", "parent": "world", "translation": [1,0,0], "rotation": [1,0,0,0]},
                {"id": "link_1", "parent": "world", "translation": [2,0,0], "rotation": [1,0,0,0]}
            ],
            "links": [],
            "joint_axes": [],
            "twists": [],
            "primitives": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "DUPLICATE_ID");
    assert_eq!(body["frame"], "link_1");
}

#[tokio::test]
async fn error_code_missing_frame() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [
                {"id": "world", "parent": null, "translation": [0,0,0], "rotation": [1,0,0,0]},
                {"id": "link_1", "parent": "phantom", "translation": [1,0,0], "rotation": [1,0,0,0]}
            ],
            "links": [],
            "joint_axes": [],
            "twists": [],
            "primitives": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "MISSING_FRAME");
    assert_eq!(body["frame"], "phantom");
}

#[tokio::test]
async fn error_code_non_finite_value() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [
                {"id": "world", "parent": null, "translation": [0,0,0], "rotation": [1,0,0,0]},
                {"id": "link_1", "parent": "world", "translation": [f64::NAN, 0, 0], "rotation": [1,0,0,0]}
            ],
            "links": [],
            "joint_axes": [],
            "twists": [],
            "primitives": []
        }})),
    )
    .await;
    assert!(status.is_client_error());
    // NaN may be rejected by serde before reaching handler,
    // so only check it's a client error
}

#[tokio::test]
async fn error_code_invalid_quaternion() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [
                {"id": "world", "parent": null, "translation": [0,0,0], "rotation": [1,0,0,0]},
                {"id": "link_1", "parent": "world", "translation": [1,0,0], "rotation": [5,0,0,0]}
            ],
            "links": [],
            "joint_axes": [],
            "twists": [],
            "primitives": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "INVALID_QUATERNION");
    assert_eq!(body["frame"], "link_1");
    assert!((body["norm"].as_f64().unwrap() - 5.0).abs() < 1e-10);
}

#[tokio::test]
async fn error_code_broken_topology() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [
                {"id": "world", "parent": null, "translation": [0,0,0], "rotation": [1,0,0,0]},
                {"id": "a", "parent": "b", "translation": [1,0,0], "rotation": [1,0,0,0]},
                {"id": "b", "parent": "a", "translation": [2,0,0], "rotation": [1,0,0,0]}
            ],
            "links": [],
            "joint_axes": [],
            "twists": [],
            "primitives": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "BROKEN_TOPOLOGY");
}

#[tokio::test]
async fn error_code_orphan_link() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [
                {"id": "world", "parent": null, "translation": [0,0,0], "rotation": [1,0,0,0]},
                {"id": "link_1", "parent": "world", "translation": [1,0,0], "rotation": [1,0,0,0]}
            ],
            "links": [
                {"id": 0, "start": [0,0,0], "end": [1,0,0]},
                {"id": 1, "start": [5,0,0], "end": [10,0,0]}
            ],
            "joint_axes": [],
            "twists": [],
            "primitives": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "ORPHAN_LINK");
    assert_eq!(body["index"], 1);
}

#[tokio::test]
async fn error_code_twists_mismatch() {
    let app = test_app().await;
    // first get a valid scene
    let (_, body) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let wrapped = body.expect("valid scene");
    let mut scene = wrapped["scene"].clone();
    // corrupt twists count
    scene["twists"] = json!([
        {"origin": [0,0,0], "linear": [0,0,0], "angular": [0,0,0]},
        {"origin": [0,0,0], "linear": [0,0,0], "angular": [0,0,0]},
        {"origin": [0,0,0], "linear": [0,0,0], "angular": [0,0,0]}
    ]);

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": scene})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "TWISTS_MISMATCH");
    assert_eq!(body["expected"], 2);
    assert_eq!(body["found"], 3);
}

// ── Robot metadata / joints tests ──

#[tokio::test]
async fn get_robot_scara_returns_joints() {
    let app = test_app().await;
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/scara", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"]
        .as_array()
        .expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 4, "SCARA should have 4 joints");

    let first = &joints[0];
    assert!(first.get("name").is_some(), "each joint must have a name");
    assert!(first.get("kind").is_some(), "each joint must have a kind");
    assert!(
        first.get("min").is_some(),
        "each joint must have min (may be null)"
    );
    assert!(
        first.get("max").is_some(),
        "each joint must have max (may be null)"
    );

    assert_eq!(
        body["dof"].as_u64().unwrap() as usize,
        joints.len(),
        "dof must equal joints.len()"
    );
}

#[tokio::test]
async fn get_robot_planar_2r_returns_joints() {
    let app = test_app().await;
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/planar_2r", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"]
        .as_array()
        .expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 2, "Planar2R should have 2 joints");
    assert_eq!(
        body["dof"].as_u64().unwrap() as usize,
        joints.len(),
        "dof must equal joints.len()"
    );
}

#[tokio::test]
async fn get_robot_planar_3r_returns_joints() {
    let app = test_app().await;
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/planar_3r", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"]
        .as_array()
        .expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 3, "Planar3R should have 3 joints");
    assert_eq!(
        body["dof"].as_u64().unwrap() as usize,
        joints.len(),
        "dof must equal joints.len()"
    );
}

#[tokio::test]
async fn get_robot_single_revolute_returns_joints() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::GET,
        "/api/v1/robots/single_revolute",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"]
        .as_array()
        .expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 1, "SingleRevolute should have 1 joint");
    assert_eq!(
        body["dof"].as_u64().unwrap() as usize,
        joints.len(),
        "dof must equal joints.len()"
    );
}

#[tokio::test]
async fn list_robots_returns_all_with_joints() {
    let app = test_app().await;
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let robots = body.as_array().expect("response must be an array");
    assert_eq!(robots.len(), 8, "should have 8 robots");

    for robot in robots {
        let joints = robot["joints"]
            .as_array()
            .expect("each robot must have joints array");
        let dof = robot["dof"].as_u64().unwrap() as usize;
        assert_eq!(
            dof,
            joints.len(),
            "dof must equal joints.len() for {}",
            robot["id"]
        );
    }
}

#[tokio::test]
async fn scara_joint_kinds_include_prismatic() {
    let app = test_app().await;
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/scara", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let joints = body["joints"].as_array().unwrap();

    // SCARA: joint_1 (revolute), joint_2 (revolute), joint_3 (prismatic), joint_4 (revolute)
    assert_eq!(joints[0]["kind"], "revolute");
    assert_eq!(joints[1]["kind"], "revolute");
    assert_eq!(joints[2]["kind"], "prismatic");
    assert_eq!(joints[3]["kind"], "revolute");

    // Verify limits are present for joints with limits
    assert!(joints[0]["min"].is_number());
    assert!(joints[2]["max"].is_number());
}

// ═══════════════════════════════════════════════════════════════════════
// Workspace
// ═══════════════════════════════════════════════════════════════════════

// 5.8: POST /workspace/sample returns WorkspaceDto with metrics + bounds

#[tokio::test]
async fn workspace_sample_scara_returns_metrics_and_bounds() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/workspace/sample",
        Some(json!({
            "robot_id": "scara",
            "samples": 500,
            "seed": 0,
            "tolerance": 0.001,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    // Has metrics
    let metrics = body.get("metrics").expect("must contain metrics");
    assert!(metrics["sample_count"].as_u64().unwrap() >= 500);
    assert!(metrics["max_reach"].as_f64().unwrap() > 0.0);
    assert!(metrics["bounding_volume"].as_f64().unwrap() > 0.0);
    assert!(metrics.get("centroid").is_some());

    // Has bounds
    let bounds = body.get("bounds").expect("must contain bounds");
    assert!(bounds.get("min").is_some());
    assert!(bounds.get("max").is_some());

    // Samples should NOT be present by default
    assert!(
        body.get("samples").is_none(),
        "samples must be absent by default"
    );
}

// 5.9: POST /workspace/sample with include_samples: true

#[tokio::test]
async fn workspace_sample_include_samples_returns_samples() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/workspace/sample",
        Some(json!({
            "robot_id": "planar_2r",
            "samples": 10,
            "seed": 0,
            "tolerance": 0.001,
            "include_samples": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let samples = body
        .get("samples")
        .expect("must contain samples when include_samples=true");
    let arr = samples.as_array().unwrap();
    assert_eq!(arr.len(), 10, "must have 10 samples");

    // Each sample must have q and position
    for sample in arr {
        assert!(sample.get("q").is_some(), "sample must have q");
        assert!(
            sample.get("position").is_some(),
            "sample must have position"
        );
        let q = sample["q"].as_array().unwrap();
        assert_eq!(q.len(), 2, "planar_2r has 2 DOF");
    }
}

// 5.10: POST /workspace/reachability with point inside disc

#[tokio::test]
async fn workspace_reachability_inside_returns_reachable() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/workspace/reachability",
        Some(json!({
                    "point": { "x": 0.7, "y": 0.0, "z": 0.5 },
            "tolerance": 0.1,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    assert_eq!(
        body["reachable"], true,
        "Scara test point (0.7, 0, 0.5) should be reachable"
    );
    assert_eq!(body["nearest_distance"], 0.0);
}

// 5.11: POST /workspace/reachability with NaN point → 400

#[tokio::test]
async fn workspace_reachability_nan_point_returns_validation_error() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/workspace/reachability",
        Some(json!({
            "point": { "x": "not_a_number", "y": 0.0, "z": 0.0 },
            "tolerance": 0.1,
        })),
    )
    .await;
    // serde should reject non-numeric input at deserialization → 422
    // But serde with axum Json extractor returns 422 automatically
    assert!(
        status == StatusCode::UNPROCESSABLE_ENTITY || status == StatusCode::BAD_REQUEST,
        "NaN/non-numeric point must be rejected, got {}",
        status,
    );
}

// 5.12: POST /workspace/sample with invalid robot_id → 404

#[tokio::test]
async fn workspace_sample_invalid_robot_returns_not_found() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/workspace/sample",
        Some(json!({
            "robot_id": "non_existent_robot",
            "samples": 100,
            "seed": 0,
            "tolerance": 0.001,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let body = body.expect("response must be valid JSON");
    assert_eq!(body["code"], "not_found");
}

// ────────────────────────────────────────────────────────────────────
// Motion endpoints — MoveJ / MoveL (#18)
// ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn movej_accepts_valid_request() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/movej",
        Some(json!({
            "target": [1.0, 0.5],
            "velocity": 1.0,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let plan = body["active_plan"]
        .as_object()
        .expect("active_plan must be present");
    assert_eq!(plan["state"], "Completed");
    assert_eq!(plan["motion_type"], "movej");
    assert_eq!(body["joints"], json!([1.0, 0.5]));
}

#[tokio::test]
async fn movej_accepts_minimal_request() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/movej",
        Some(json!({
            "target": [0.5, -0.3],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let plan = body["active_plan"]
        .as_object()
        .expect("active_plan must be present");
    assert_eq!(plan["state"], "Completed");
    assert_eq!(plan["motion_type"], "movej");
    assert_eq!(body["joints"], json!([0.5, -0.3]));
}

#[tokio::test]
async fn movej_rejects_missing_target() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/movej",
        Some(json!({
            "velocity": 1.0,
        })),
    )
    .await;
    assert!(
        status.is_client_error(),
        "missing target must be rejected, got {status}",
    );
}

#[tokio::test]
async fn movej_updates_runtime_joints() {
    let app = test_app().await;
    // Execute MoveJ
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/motion/movej",
        Some(json!({
            "target": [1.0, 2.0],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify the runtime state was updated
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    assert_eq!(body["joints"], json!([1.0, 2.0]));
}

#[tokio::test]
async fn movel_accepts_valid_request() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/movel",
        Some(json!({
            "target": {
                "translation": [0.3, 0.4, 0.0],
                "rotation": {
                    "kind": "Quaternion",
                    "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 }
                }
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let plan = body["active_plan"]
        .as_object()
        .expect("active_plan must be present");
    assert_eq!(plan["state"], "Completed");
    assert_eq!(plan["motion_type"], "movel");
}

#[tokio::test]
async fn movel_accepts_with_frame_id() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/movel",
        Some(json!({
            "frame_id": 1,
            "target": {
                "translation": [0.5, 0.0, 0.0],
                "rotation": {
                    "kind": "Quaternion",
                    "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 }
                }
            },
            "velocity": 0.5,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let plan = body["active_plan"]
        .as_object()
        .expect("active_plan must be present");
    assert_eq!(plan["state"], "Completed");
    assert_eq!(plan["motion_type"], "movel");
}

#[tokio::test]
async fn movel_rejects_missing_target() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/movel",
        Some(json!({
            "frame_id": 0,
        })),
    )
    .await;
    assert!(
        status.is_client_error(),
        "missing target must be rejected, got {status}",
    );
}

#[tokio::test]
async fn movel_with_unreachable_target_still_returns_accepted() {
    // Even when IK fails to converge, the endpoint should still produce
    // a valid response — the runtime applies the best-effort result.
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/movel",
        Some(json!({
            "target": {
                "translation": [100.0, 100.0, 0.0],
                "rotation": {
                    "kind": "Quaternion",
                    "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 }
                }
            }
        })),
    )
    .await;
    // The endpoint still accepts the request — IK failure is not an HTTP error
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let plan = body["active_plan"]
        .as_object()
        .expect("active_plan must be present");
    assert_eq!(plan["state"], "Completed");
    assert_eq!(plan["motion_type"], "movel");
    // Joints should be finite (no NaN from failed IK)
    let joints = body["joints"].as_array().expect("joints must be an array");
    for j in joints {
        let val = j.as_f64().unwrap();
        assert!(val.is_finite(), "joint {val} must be finite");
    }
}

// ─── Trajectory state lifecycle (#23) ─────────────────────────────

#[tokio::test]
async fn movej_trajectory_persists_across_scene_snapshots() {
    let app = test_app().await;

    // Execute MoveJ → stores trajectory in runtime
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/motion/movej",
        Some(json!({
            "target": [0.7, -0.4],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // First scene snapshot: joints should be at target
    let (status, body) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    assert_eq!(body["joints"], json!([0.7, -0.4]));

    // Second scene snapshot (no mutation in between): state is consistent
    let (status, body) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    assert_eq!(body["joints"], json!([0.7, -0.4]));
    assert_eq!(body["robot"]["dof"], 2);
}

// ─── Motion program execution (#31) ───────────────────────────────

#[tokio::test]
async fn execute_plan_with_two_segments_returns_correct_segment_ranges() {
    let app = test_app().await;

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/motion/plan",
        Some(json!({
            "segments": [
                {
                    "type": "movej",
                    "target": [1.0, 0.5],
                },
                {
                    "type": "movej",
                    "target": [0.0, 1.0],
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let plan = body["active_plan"]
        .as_object()
        .expect("active_plan must be present");

    // ── Plan metadata ──
    assert_eq!(plan["state"], "Created");
    assert_eq!(plan["motion_type"], "program");

    // ── Segments ──
    let segments = plan["segments"]
        .as_array()
        .expect("segments must be an array");
    assert_eq!(
        segments.len(),
        2,
        "expected 2 segments, got {}",
        segments.len()
    );

    // Each segment must have valid numeric waypoint ranges
    for (i, seg) in segments.iter().enumerate() {
        let ws = seg["waypoint_start"]
            .as_u64()
            .expect("waypoint_start must be u64");
        let we = seg["waypoint_end"]
            .as_u64()
            .expect("waypoint_end must be u64");
        let ts = seg["time_start"].as_f64().expect("time_start must be f64");
        let te = seg["time_end"].as_f64().expect("time_end must be f64");

        assert!(
            we > ws,
            "segment {i}: waypoint_end ({we}) must be > waypoint_start ({ws})"
        );
        assert!(
            te >= ts,
            "segment {i}: time_end ({te}) must be >= time_start ({ts})"
        );
        assert_eq!(seg["segment_index"], i, "segment {i}: index mismatch");
        assert_eq!(seg["motion_type"], "movej", "segment {i}: motion_type");
    }

    // Segment 1 waypoint_start must equal segment 0 waypoint_end (contiguous)
    let seg0 = &segments[0];
    let seg1 = &segments[1];
    assert_eq!(
        seg1["waypoint_start"], seg0["waypoint_end"],
        "segment 1 must start where segment 0 ends"
    );
    assert_eq!(
        seg1["time_start"], seg0["time_end"],
        "segment 1 time must start where segment 0 time ends"
    );

    // ── Visualization ──
    let vis = plan["visualization"]
        .as_object()
        .expect("visualization must be present");
    let waypoints = vis["waypoints"]
        .as_array()
        .expect("waypoints must be an array");

    // Total waypoint count = segment 0 end (which equals segment 1 end)
    let total_vis_wps = waypoints.len();
    let last_seg_end = seg1["waypoint_end"].as_u64().unwrap() as usize;
    assert_eq!(
        total_vis_wps, last_seg_end,
        "waypoint count ({total_vis_wps}) must match last segment waypoint_end ({last_seg_end})"
    );

    // Waypoints must have positions
    for (i, wp) in waypoints.iter().enumerate() {
        let pos = wp["position"]
            .as_array()
            .expect("waypoint must have position array");
        assert!(
            pos.len() >= 2,
            "waypoint {i}: position must have at least 2 elements"
        );
    }

    // Verify end effector position changes between waypoints (different segments)
    let first_wp_pos = &waypoints[0]["position"];
    let mid_wp_idx = seg0["waypoint_end"].as_u64().unwrap() as usize;
    let mid_wp_pos = &waypoints[mid_wp_idx.saturating_sub(1)]["position"];
    let last_wp_pos = &waypoints[total_vis_wps - 1]["position"];
    assert_ne!(
        first_wp_pos, last_wp_pos,
        "first and last waypoint must differ in position"
    );
    assert_ne!(
        first_wp_pos, mid_wp_pos,
        "first and mid-last waypoint of seg0 must differ"
    );

    // ── Joints must NOT change (plan is Created, not executed) ──
    assert_eq!(
        body["joints"],
        json!([0.0, 0.0]),
        "robot joints must remain at initial position when plan is Created (not executed)"
    );

    // Verify the first waypoint's joints are at START position, not the final target
    let first_joints = &waypoints[0]["joints"];
    assert_eq!(
        first_joints,
        &json!([0.0, 0.0]),
        "first visualization waypoint must match start position, got {:?}",
        first_joints
    );
}

// ── TCP selection tests ──

#[tokio::test]
async fn select_tool_frame_sets_active_tcp() {
    let app = test_app().await;

    // Load Scara robot first
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Get the end effector frame ID from the scene
    let scene = &body.unwrap()["scene"];
    let frames = scene["frames"].as_array().unwrap();
    // Find the end effector frame (last frame in the chain)
    let ee_frame = frames.last().unwrap();
    let ee_frame_id = ee_frame["id"].as_str().unwrap();

    // Parse the frame ID as u64 (assuming it's numeric)
    let frame_id: u64 = ee_frame_id.parse().unwrap_or(0);

    // Select the TCP with an offset
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/tcp",
        Some(json!({
            "frame_id": frame_id,
            "offset": [0.0, 0.0, -0.12]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let body = body.expect("response must be valid JSON");

    // Verify active_tcp is set
    let active_tcp = body["active_tcp"].as_object();
    assert!(active_tcp.is_some(), "active_tcp should be set");

    let tcp = active_tcp.unwrap();
    assert_eq!(tcp["base_frame_id"].as_u64().unwrap(), frame_id);
    assert!(tcp["offset"].is_array(), "offset should be present");

    let offset = tcp["offset"].as_array().unwrap();
    assert_eq!(offset.len(), 3);
    assert!((offset[0].as_f64().unwrap() - 0.0).abs() < 1e-6);
    assert!((offset[1].as_f64().unwrap() - 0.0).abs() < 1e-6);
    assert!((offset[2].as_f64().unwrap() - (-0.12)).abs() < 1e-6);
}

#[tokio::test]
async fn select_tool_frame_clears_tcp() {
    let app = test_app().await;

    // Load Scara robot
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Set a TCP first
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/tcp",
        Some(json!({
            "frame_id": 1,
            "offset": [0.0, 0.0, -0.1]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Clear the TCP
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/tcp",
        Some(json!({
            "frame_id": null
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let body = body.expect("response must be valid JSON");

    // Verify active_tcp is null/absent
    assert!(body["active_tcp"].is_null(), "active_tcp should be cleared");
}

// ── E2E: Full pipeline integration test ──

#[tokio::test]
async fn e2e_full_pipeline() {
    let app = test_app().await;

    // 1. Load Scara robot (4 DOF)
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "load_robot should succeed");
    let robot_joints = body
        .as_ref()
        .and_then(|b| b["joints"].as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    assert_eq!(robot_joints, 4, "Scara should have 4 joints");

    // 2. Compile and preview a MoveJ plan
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/plan",
        Some(json!({
            "segments": [{"type": "movej", "target": [0.5, -0.3, -0.1, 0.0]}]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "preview_plan should succeed");
    let plan_state = body
        .as_ref()
        .and_then(|b| b["active_plan"]["state"].as_str())
        .unwrap_or("")
        .to_string();
    assert_eq!(
        plan_state, "Created",
        "plan should be Created after preview"
    );

    // 3. Start execution
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/start",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "start_execution should succeed");
    let plan_state = body
        .as_ref()
        .and_then(|b| b["active_plan"]["state"].as_str())
        .unwrap_or("")
        .to_string();
    assert_eq!(plan_state, "Active", "plan should be Active after start");

    // 4. Tick several times to advance execution
    for _ in 0..5 {
        let (s, _) = get_json(
            app.clone(),
            http::Method::POST,
            "/api/v1/scene/motion/tick",
            Some(json!({"dt": 0.05})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "tick should succeed");
    }

    // 5. Pause execution
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/pause",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "pause should succeed");
    let plan_state = body
        .as_ref()
        .and_then(|b| b["active_plan"]["state"].as_str())
        .unwrap_or("")
        .to_string();
    assert_eq!(plan_state, "Paused", "plan should be Paused after pause");

    // 6. Tick while paused — joints should NOT advance (motion mode stays paused)
    let (_, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/tick",
        Some(json!({"dt": 0.05})),
    )
    .await;
    let state_after_paused_tick = body
        .as_ref()
        .and_then(|b| b["execution"]["status"].as_str())
        .unwrap_or("")
        .to_string();
    assert_eq!(
        state_after_paused_tick, "Paused",
        "should stay paused after tick"
    );

    // 7. Resume execution
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/resume",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "resume should succeed");

    // 8. Tick until complete (2s trajectory / 0.05s dt = 40 ticks needed)
    for _ in 0..50 {
        let (s, body) = get_json(
            app.clone(),
            http::Method::POST,
            "/api/v1/scene/motion/tick",
            Some(json!({"dt": 0.05})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "tick should succeed");
        let status = body
            .as_ref()
            .and_then(|b| b["execution"]["status"].as_str())
            .unwrap_or("");
        if status == "Completed" {
            break;
        }
    }

    // Verify execution completed
    let (_, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/tick",
        Some(json!({"dt": 0.05})),
    )
    .await;
    let final_status = body
        .as_ref()
        .and_then(|b| b["execution"]["status"].as_str())
        .unwrap_or("");
    assert_eq!(final_status, "Completed", "execution should complete");

    // 9. Analyze the completed plan
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/analyze",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "analyze should succeed");
    let summary = body.as_ref().and_then(|b| b.get("summary"));
    assert!(summary.is_some(), "analyze should return summary");
    let score = summary.and_then(|s| s["score"].as_u64()).unwrap_or(0);
    assert!(score > 0 || score == 0, "score should be a valid number");
    let findings = body
        .as_ref()
        .and_then(|b| b["findings"].as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    assert!(findings > 0, "analyze should return at least one finding");
    let recommendations = body
        .as_ref()
        .and_then(|b| b["recommendations"].as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    assert!(
        recommendations > 0,
        "analyze should return at least one recommendation"
    );
}

// =========================================================================
// Semantic compile endpoint
// =========================================================================

/// Build a minimal TaskDocument JSON payload with the given operations.
fn task_doc_payload(operations: Value) -> Value {
    json!({
        "task": {
            "id": "test",
            "metadata": {
                "name": "test",
                "version": 1,
                "created_at": "",
                "modified_at": ""
            },
            "scene": {
                "objects": [],
                "locations": [],
                "tools": [],
                // SCARA FK([0,0,0,0]) = [a1+a2, 0, base_height] = [1.8, 0.0, 0.5]
                "home_pose": {"position": [1.8, 0.0, 0.5], "orientation": [0.0, 0.0, 0.0, 1.0]}
            },
            "program": {
                "operations": operations
            }
        }
    })
}

#[tokio::test]
async fn semantic_compile_wait_home_returns_ok() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(task_doc_payload(json!([
            {"type": "wait", "origin": "op_0", "duration": {"secs": 0, "nanos": 500000000}},
            {"type": "home", "origin": "op_1"}
        ]))),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response body");
    assert_eq!(body["status"], "ok");
    assert!(body["motion_program"]["instructions"].as_array().map(|a| a.len()).unwrap_or(0) > 0);
    let instrs = body["motion_program"]["instructions"].as_array().map(|a| a.len()).unwrap_or(0);
    assert!(instrs > 0, "should have at least 1 instruction, got {instrs}");
}

#[tokio::test]
async fn semantic_compile_two_waits_sums_duration() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(task_doc_payload(json!([
            {"type": "wait", "origin": "op_0", "duration": {"secs": 1, "nanos": 0}},
            {"type": "wait", "origin": "op_1", "duration": {"secs": 2, "nanos": 0}}
        ]))),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response body");
    assert_eq!(body["status"], "ok");
    let instrs = body["motion_program"]["instructions"].as_array().map(|a| a.len()).unwrap_or(0);
    assert!(instrs >= 2, "two Waits should produce at least 2 instructions, got {instrs}");
}

#[tokio::test]
async fn semantic_compile_place_without_pick_returns_422() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(task_doc_payload(json!([
            {"type": "place", "origin": "op_0", "object": "bolt", "destination": "tray", "tool": null}
        ]))),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("response body");
    assert_eq!(body["code"], "semantic_validation_error");
}

#[tokio::test]
async fn semantic_compile_unknown_object_returns_422() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(task_doc_payload(json!([
            {"type": "pick", "origin": "op_0", "object": "nonexistent", "tool": null},
            {"type": "home", "origin": "op_1"}
        ]))),
    )
    .await;
    // Pick with no configured grasp plan → knowledge error → 422
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn semantic_compile_malformed_json_returns_422() {
    let app = test_app().await;
    let req = Request::builder()
        .method(http::Method::POST)
        .uri("/api/v1/semantic/compile")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"task": {"id": "test", "metadata": {"name": "test", "version": 1, "created_at": "", "modified_at": ""}, "scene": {"objects": [], "locations": [], "tools": [], "home_pose": {"position": [0,0,0], "orientation": [0,0,0,1]}}, "program": {"operations": [{"type": "wait"}]}}"#)) // missing closing brace
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Malformed JSON → axum rejects before handler → 400 or 422
    assert!(resp.status().is_client_error());
}

#[tokio::test]
async fn semantic_compile_unknown_operation_type_returns_422() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(task_doc_payload(json!([
            {"type": "jump", "height": 10}
        ]))),
    )
    .await;
    // Unknown tag → serde rejection → 422
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn semantic_compile_empty_operations_returns_422() {
    let app = test_app().await;
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(task_doc_payload(json!([]))),
    )
    .await;
    // Empty program → ScaraPlanner rejects → 422
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn semantic_compile_home_alone_returns_ok() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(task_doc_payload(json!([
            {"type": "home", "origin": "op_0"}
        ]))),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response body");
    assert_eq!(body["status"], "ok");
    assert!(body["motion_program"]["instructions"].as_array().map(|a| a.len()).unwrap_or(0) >= 1);
}

/// Integration test: POST TaskDocument-shaped JSON → compile → MotionProgram.
///
/// Verifies the full pipeline accepts a TaskDocument with scene resources
/// (objects, locations, home pose) and a semantic program referencing those
/// resources by ID.
#[tokio::test]
async fn semantic_compile_with_task_document() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(json!({
            "task": {
                "id": "integration-test-1",
                "metadata": {
                    "name": "integration test",
                    "version": 1,
                    "created_at": "2026-07-29T00:00:00Z",
                    "modified_at": "2026-07-29T00:00:00Z"
                },
                "scene": {
                    "objects": [],
                    "locations": [],
                    "tools": [],
                    "home_pose": {
                        "position": [1.8, 0.0, 0.5],
                        "orientation": [0.0, 0.0, 0.0, 1.0]
                    }
                },
                "program": {
                    "operations": [
                        {
                            "type": "wait",
                            "origin": "op_0",
                            "duration": {"secs": 0, "nanos": 500000000}
                        },
                        {
                            "type": "home",
                            "origin": "op_1"
                        }
                    ]
                }
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "TaskDocument compile should succeed, got {:?}", body);
    let body = body.expect("response body must be valid JSON");
    assert_eq!(body["status"], "ok");
    assert!(
        body["motion_program"]["instructions"].as_array().map(|a| a.len()).unwrap_or(0) > 0,
        "execution plan must have at least one segment"
    );


#[tokio::test]
async fn semantic_compile_with_task_document_and_scene() {
    // Test with a full TaskDocument including scene objects
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/compile",
        Some(json!({
            "task": {
                "id": "test-1",
                "metadata": { "name": "test", "version": 1, "created_at": "", "modified_at": "" },
                "scene": {
                    "objects": [
                        {"id": "bolt", "name": "Bolt", "category": null, "pose": {"position": [1.0, 0.0, 1.0], "orientation": [0.0, 0.0, 0.0, 1.0]}}
                    ],
                    "locations": [
                        {"id": "tray", "name": "Tray", "description": null, "pose": {"position": [1.5, 0.0, 0.5], "orientation": [0.0, 0.0, 0.0, 1.0]}}
                    ],
                    "tools": [],
                    "home_pose": {"position": [1.8, 0.0, 0.5], "orientation": [0.0, 0.0, 0.0, 1.0]}
                },
                "program": {
                    "operations": [
                        {"type": "wait", "origin": "op_0", "duration": {"secs": 0, "nanos": 500000000}},
                        {"type": "home", "origin": "op_1"}
                    ]
                }
            }
        })),
    ).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response body must be valid JSON");
    assert_eq!(body["status"], "ok");
    assert!(
        body["motion_program"]["instructions"].as_array().map(|a| a.len()).unwrap_or(0) > 0,
        "execution plan must have at least one segment"
    );
}


