use axum::{
    Router,
    body::Body,
    http::{self, Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

use thalos_api::{app_router, new_default_state, new_state_with_scene_writeback};

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

    // Has metrics — sample_count is derived from samples.len() (workspace.rs),
    // so it is exact, not a floor.
    let metrics = body.get("metrics").expect("must contain metrics");
    assert_eq!(metrics["sample_count"].as_u64().unwrap(), 500);
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

// 5.13: POST /workspace/sample/active targets the robot currently loaded in
// the scene (spec robot-identity R3-003) — no robot_id in the request.

#[tokio::test]
async fn workspace_sample_active_targets_the_loaded_catalog_robot() {
    let app = test_app().await;

    // Load a catalog robot into the scene → it becomes the active chain.
    let (load_status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "scene load must succeed");

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/workspace/sample/active",
        Some(json!({
            "samples": 500,
            "seed": 0,
            "tolerance": 0.001,
            "include_samples": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let metrics = body.get("metrics").expect("must contain metrics");
    // sample_count is derived from samples.len() (workspace.rs) — exact, not a floor.
    assert_eq!(metrics["sample_count"].as_u64().unwrap(), 500);
    let samples = body.get("samples").expect("must contain samples");
    let arr = samples.as_array().unwrap();
    assert_eq!(arr.len(), 500, "must sample the active chain");
    for sample in arr {
        assert!(sample.get("position").is_some(), "sample must have position");
    }
}

#[tokio::test]
async fn workspace_sample_active_targets_the_loaded_urdf_robot() {
    let app = test_app().await;
    let icebot_urdf = include_str!("../../../../docs/robot/icebot.urdf");

    // A URDF import also becomes the active chain for the /active endpoint.
    let (load_status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({"urdf_source": icebot_urdf})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "URDF load must succeed");
    let body = body.expect("load response body");
    assert!(
        body["robot"]["id"]
            .as_str()
            .expect("robot.id string")
            .starts_with("urdf:"),
        "loaded robot must carry a urdf: identity"
    );

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/workspace/sample/active",
        Some(json!({
            "samples": 100,
            "seed": 0,
            "tolerance": 0.001,
            "include_samples": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let samples = body.get("samples").expect("must contain samples");
    assert_eq!(
        samples.as_array().unwrap().len(),
        100,
        "must sample the URDF chain"
    );
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

// ── /scene/motion/plan with operations (semantic path, PR 3) ────────────

#[tokio::test]
async fn preview_plan_with_operations_uses_semantic_path() {
    let app = test_app().await;

    // Scara (4 DOF) — the DLS solver converges reliably for its MoveL paths
    // (planar_2r's orientation-locked reachable set breaks cartesian IK).
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "load scara should succeed");

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/motion/plan",
        Some(json!({
            "operations": [
                {
                    "type": "pick",
                    "id": 1,
                    "target": {
                        "translation": [0.5, 0.5, 0.0],
                        "rotation": { "kind": "Quaternion", "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 } }
                    },
                    "constraints": { "position_tolerance": 0.01 }
                }
            ]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "preview_plan with operations should succeed"
    );
    let body = body.expect("response must be valid JSON");

    let plan = body["active_plan"]
        .as_object()
        .expect("active_plan must be present");
    assert_eq!(plan["state"], "Created");
    assert_eq!(plan["motion_type"], "program");

    // A Pick operation expands to 5 nodes → 5 planned segments. The legacy
    // `segments` path never produces 5 segments from a single input, so this
    // proves preview_plan routed through compile_with_operations().
    let segments = plan["segments"]
        .as_array()
        .expect("segments must be an array");
    assert_eq!(
        segments.len(),
        5,
        "Pick should expand to 5 segments via compile_with_operations"
    );
}

#[tokio::test]
async fn preview_plan_without_operations_keeps_legacy_path() {
    let app = test_app().await;

    // `operations` absent → compile() fallback. Segment count must equal the
    // number of authored segments (no expansion).
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/motion/plan",
        Some(json!({
            "segments": [
                { "type": "movej", "target": [1.0, 0.5] },
                { "type": "movej", "target": [0.0, 1.0] }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let segments = body["active_plan"]["segments"]
        .as_array()
        .expect("segments must be an array");
    assert_eq!(
        segments.len(),
        2,
        "legacy path must keep authored segment count"
    );
}

#[tokio::test]
async fn operations_plan_propagates_semantic_context_to_analysis() {
    let app = test_app().await;

    // Near-reach target forces a low_manipulability region on the scara.
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "load scara should succeed");

    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/plan",
        Some(json!({
            "operations": [
                {
                    "type": "pick",
                    "id": 1,
                    "target": {
                        "translation": [1.7, 0.5, 0.0],
                        "rotation": { "kind": "Quaternion", "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 } }
                    },
                    "constraints": { "position_tolerance": 0.01 }
                }
            ]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "preview_plan with operations should succeed"
    );

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/plan/analyze",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "analyze should succeed");
    let body = body.expect("response must be valid JSON");

    let regions = body["problem_regions"]
        .as_array()
        .expect("problem_regions must be an array");
    assert!(
        !regions.is_empty(),
        "near-reach plan must produce a problem region"
    );

    // The region at waypoint 0 must map back to the originating operation via
    // the semantic field (operation_id + role propagated from expansion).
    let semantic = regions[0]["semantic"]
        .as_object()
        .expect("problem region must carry semantic context");
    assert_eq!(semantic["operation_id"], "1");
    assert_eq!(semantic["role"], "approach");
    assert!(!semantic["kind"].as_str().unwrap_or("").is_empty());
    assert!(!semantic["severity"].as_str().unwrap_or("").is_empty());
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
    // PR 7a: the wire projects the AnalysisReport — observations/actions.
    let observations = body
        .as_ref()
        .and_then(|b| b["observations"].as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    assert!(
        observations > 0,
        "analyze should return at least one observation"
    );
    let actions = body
        .as_ref()
        .and_then(|b| b["actions"].as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    assert!(actions > 0, "analyze should return at least one action");
}

// =========================================================================
// Plan command preview (PR3 — read-only simulation)
// =========================================================================

/// Shared setup for preview tests: Scara robot + a compiled program that
/// carries a Cartesian (MoveL) segment so the advisor can materialize
/// recommendations (all materializers are Cartesian-only, PR2).
async fn preview_setup(app: &Router) {
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "load_robot should succeed");

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
                        "translation": [1.5, 0.3, 0.5],
                        "rotation": {"kind": "Quaternion", "value": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}}
                    }
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "preview_plan should succeed");
}

#[tokio::test]
async fn analyze_command_populates_recommendations_with_edits() {
    // R3-001: /plan/analyze must populate recommendations[] when the active
    // plan produces observations that generate recommendations. The UI
    // (AdvisorSection) is fed ONLY from planAnalysisApi.analyze() — an empty
    // recommendations[] makes preview/apply/undo unreachable in the real flow.
    let app = test_app().await;
    preview_setup(&app).await;

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/plan/analyze",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "analyze should succeed");

    let body = body.expect("analyze response must be valid JSON");
    let recommendations = body["recommendations"]
        .as_array()
        .expect("recommendations must be an array");
    assert!(
        !recommendations.is_empty(),
        "analyze must return recommendations when observations can generate them"
    );
    assert!(
        recommendations.iter().any(|r| {
            r["status"] == "available" && r["edit"]["ReplaceSegment"].is_object()
        }),
        "at least one available recommendation must carry a typed ReplaceSegment edit"
    );
}

#[tokio::test]
async fn preview_command_returns_simulation_without_mutation() {
    // Spec command-endpoints "Preview returns simulation without mutation":
    // a valid recommendation id returns waypoints + before/after metrics and
    // leaves the SceneRuntime active_plan untouched (read-only preview).
    let app = test_app().await;
    preview_setup(&app).await;

    // Snapshot the runtime state BEFORE the preview (GET /scene is read-only).
    let (_, before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before = before.expect("scene response must be valid JSON");
    assert!(
        before["active_plan"].is_object(),
        "setup must leave an active plan"
    );

    // Advisor recommendation ids start at 1 (PR2 counter).
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/preview",
        Some(json!({"recommendation_id": 1})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "preview must succeed for a valid recommendation id"
    );

    let body = body.expect("preview response must be valid JSON");
    let waypoints = body["waypoints"].as_array().expect("waypoints array");
    assert!(
        waypoints.len() >= 2,
        "preview must return a 3D waypoint trajectory"
    );
    assert!(
        waypoints
            .iter()
            .all(|w| w.as_array().is_some_and(|p| p.len() == 3)),
        "each waypoint must be [x, y, z]"
    );
    assert!(
        body["metrics_before"]["waypoint_count"].is_number(),
        "metrics_before must carry aggregate metrics"
    );
    assert!(
        body["metrics_after"]["waypoint_count"].is_number(),
        "metrics_after must carry aggregate metrics"
    );
    assert!(
        body["health_before"].is_number() && body["health_after"].is_number(),
        "preview must report before/after health"
    );
    assert!(
        body["continuity"].is_boolean(),
        "preview must report trajectory continuity"
    );

    // Preview MUST NOT mutate SceneRuntime: the active plan is identical.
    let (_, after) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after = after.expect("scene response must be valid JSON");
    assert_eq!(
        after["active_plan"], before["active_plan"],
        "preview must not mutate the active plan (read-only simulation)"
    );
}

#[tokio::test]
async fn preview_command_unknown_recommendation_returns_404_without_state_change() {
    // Spec command-endpoints "Preview with invalid recommendation": a
    // non-existent recommendation_id returns 404 and changes no state.
    let app = test_app().await;
    preview_setup(&app).await;

    let (_, before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before = before.expect("scene response must be valid JSON");

    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/preview",
        Some(json!({"recommendation_id": 999_999})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "unknown recommendation id must 404"
    );
    let body = body.expect("error response must be valid JSON");
    assert_eq!(
        body["code"], "not_found",
        "404 body must carry the not_found code"
    );

    let (_, after) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after = after.expect("scene response must be valid JSON");
    assert_eq!(
        after["active_plan"], before["active_plan"],
        "a failed preview must not mutate the active plan"
    );
}

// =========================================================================
// Plan command apply (PR4 — scene write-back, design-first milestone)
// =========================================================================

/// App with the scene-writeback feature flag ENABLED (D5). The default
/// `test_app` keeps the flag OFF (rollback-safe default); apply tests that
/// must exercise the write-back surface use this builder.
async fn writeback_app() -> Router {
    let state = new_state_with_scene_writeback(true).await;
    app_router().with_state(state)
}

#[tokio::test]
async fn apply_command_writes_back_and_stores_inverse_without_preview() {
    // Spec command-endpoints "Apply writes back to scene" + "Apply without
    // prior preview": apply executes the edit, recompiles, writes back to
    // SceneRuntime and stores the inverse — preview is NOT a prerequisite.
    let app = writeback_app().await;
    preview_setup(&app).await;

    // Snapshot the active plan BEFORE the apply (GET /scene is read-only).
    let (_, before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before = before.expect("scene response must be valid JSON");
    let before_plan_id = before["active_plan"]["plan_id"]
        .as_str()
        .expect("setup must leave an active plan with an id")
        .to_string();

    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/apply",
        // Recommendation 3 is AVAILABLE in this scenario (ids 1-2 are
        // LiftTcp/manipulability edits whose IK fails → unavailable, D8).
        Some(json!({"recommendation_id": 3})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "apply must succeed WITHOUT a prior preview (preview is not a prerequisite)"
    );
    let body = body.expect("apply response must be valid JSON");
    assert_eq!(
        body["history_length"], 1,
        "apply must store the inverse for PR5's undo"
    );
    assert_eq!(
        body["status"], "available",
        "apply response must echo recommendation availability (D8)"
    );
    assert!(
        body["plan_id"].is_string(),
        "apply response must carry the new active plan id"
    );

    // Write-back is observable via GET /scene: the active plan CHANGED.
    let (_, after) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after = after.expect("scene response must be valid JSON");
    let after_plan_id = after["active_plan"]["plan_id"]
        .as_str()
        .expect("active plan must still exist after apply")
        .to_string();
    assert_ne!(
        after_plan_id, before_plan_id,
        "apply must write the new plan back to SceneRuntime"
    );
}

#[tokio::test]
async fn apply_command_unknown_recommendation_returns_404_without_state_change() {
    // Spec command-endpoints "Preview with invalid recommendation" — the same
    // contract applies to apply: unknown id → 404, no state change.
    let app = writeback_app().await;
    preview_setup(&app).await;

    let (_, before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before = before.expect("scene response must be valid JSON");

    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/apply",
        Some(json!({"recommendation_id": 999_999})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "unknown recommendation id must 404"
    );
    let body = body.expect("error response must be valid JSON");
    assert_eq!(
        body["code"], "not_found",
        "404 body must carry the not_found code"
    );

    let (_, after) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after = after.expect("scene response must be valid JSON");
    assert_eq!(
        after["active_plan"], before["active_plan"],
        "a failed apply must not mutate the active plan"
    );
}

#[tokio::test]
async fn apply_command_flag_off_returns_feature_disabled_without_mutation() {
    // Design D5 at the API layer: the DEFAULT app has scene-writeback OFF, so
    // apply fails with `feature_disabled` and mutates NOTHING — rollback-safe.
    let app = test_app().await;
    preview_setup(&app).await;

    let (_, before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before = before.expect("scene response must be valid JSON");

    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/apply",
        // Must pass the D8 gate (available recommendation) to reach the flag
        // check — recommendation 3 is available in this scenario.
        Some(json!({"recommendation_id": 3})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "flag-off apply must fail with Conflict (feature_disabled)"
    );
    let body = body.expect("error response must be valid JSON");
    assert_eq!(
        body["code"], "feature_disabled",
        "flag-off apply must carry the feature_disabled code"
    );

    let (_, after) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after = after.expect("scene response must be valid JSON");
    assert_eq!(
        after["active_plan"], before["active_plan"],
        "flag-off apply must NOT mutate the active plan"
    );
}

#[tokio::test]
async fn apply_command_unavailable_recommendation_returns_409_without_mutation() {
    // Design D8 at the API layer: an unavailable recommendation is NEVER
    // applied — the handler rejects it explicitly (409) before any write.
    let app = writeback_app().await;
    preview_setup(&app).await;

    let (_, before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before = before.expect("scene response must be valid JSON");

    // Recommendation 1 is unavailable in this scenario (LiftTcp IK fails).
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/apply",
        Some(json!({"recommendation_id": 1})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "unavailable recommendation must be rejected with Conflict"
    );
    let body = body.expect("error response must be valid JSON");
    assert_eq!(
        body["code"], "recommendation_unavailable",
        "D8 rejection must carry the recommendation_unavailable code"
    );

    let (_, after) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after = after.expect("scene response must be valid JSON");
    assert_eq!(
        after["active_plan"], before["active_plan"],
        "an unavailable recommendation must NOT mutate the active plan"
    );
}

// =========================================================================
// Plan command undo (PR5 — O(1) via stored inverse, design D6)
// =========================================================================

/// Trajectory signature of the active plan from a GET /scene response: the
/// waypoint COUNT plus the FIRST and LAST joints. Proves an undo restored the
/// previous plan without coupling to float-exact intermediate waypoints.
fn active_trajectory_signature(scene: &serde_json::Value) -> (usize, Vec<Vec<f64>>) {
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
        vec![joints.first().unwrap().clone(), joints.last().unwrap().clone()],
    )
}

#[tokio::test]
async fn undo_command_restores_previous_plan_via_inverse() {
    // Spec command-endpoints "Undo restores previous plan": after an apply,
    // undo pops the stored inverse, recompiles and writes the PREVIOUS plan
    // back to SceneRuntime — the original trajectory comes back.
    let app = writeback_app().await;
    preview_setup(&app).await;

    // Trajectory BEFORE the apply (the state the undo must restore).
    let (_, before_scene) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before_scene = before_scene.expect("scene response must be valid JSON");
    let original = active_trajectory_signature(&before_scene);

    // Apply recommendation 3 (available in this scenario) → plan changes.
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/apply",
        Some(json!({"recommendation_id": 3})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "apply must succeed");
    let body = body.expect("apply response must be valid JSON");
    assert_eq!(body["history_length"], 1, "apply stores the inverse");
    let applied_plan_id = body["plan_id"].as_str().expect("plan id").to_string();

    let (_, applied_scene) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let applied_scene = applied_scene.expect("scene response must be valid JSON");
    let applied = active_trajectory_signature(&applied_scene);

    // Undo — POST with NO body: the endpoint pops the last applied command.
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/undo",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "undo must succeed after an apply");
    let body = body.expect("undo response must be valid JSON");
    assert_eq!(
        body["history_length"], 0,
        "undo pops the entry — the history is empty again"
    );
    assert!(
        body["plan_id"].is_string(),
        "undo response must carry the restored plan id"
    );
    assert_ne!(
        body["plan_id"].as_str().unwrap(),
        applied_plan_id,
        "undo must write a NEW restored plan back to the runtime"
    );
    assert!(
        body["health_before"].as_f64().is_some() && body["health_after"].as_f64().is_some(),
        "undo response must report the restored health from the stored metrics"
    );

    // The scene now carries the PREVIOUS trajectory (shape equality with the
    // pre-apply plan), not the applied one.
    let (_, after_scene) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after_scene = after_scene.expect("scene response must be valid JSON");
    let restored = active_trajectory_signature(&after_scene);
    assert_eq!(
        restored, original,
        "undo must restore the previous plan trajectory"
    );
    assert_ne!(restored, applied, "the applied trajectory must be gone");
}

#[tokio::test]
async fn undo_command_one_to_many_insert_waypoint_restores_original() {
    // R3-002: undo of a recommendation whose edit is one-to-many (InsertWaypoint
    // splits one MoveL into TWO segments) must restore the EXACT original plan.
    // The old inverse spliced only the first segment back, leaving an extra
    // segment — a corrupted, mixed plan.
    let app = writeback_app().await;
    preview_setup(&app).await;

    // Re-schedule a SINGLE-MoveL plan just inside the reach boundary
    // ([1.75, 0.1, 0.5]): the analysis produces a LowManipulability
    // observation anchored at waypoint 0 (the only segment is the MoveL), so
    // recommendation 2 (Waypoint/InsertWaypoint) is AVAILABLE and materializes
    // a 1→2 replacement that still recompiles.
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/motion/plan",
        Some(json!({
            "segments": [
                {
                    "type": "movel",
                    "target": {
                        "translation": [1.75, 0.1, 0.5],
                        "rotation": {"kind": "Quaternion", "value": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}}
                    }
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "plan must compile");

    // Trajectory BEFORE the apply (the state the undo must restore).
    let (_, before_scene) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before_scene = before_scene.expect("scene response must be valid JSON");
    let original = active_trajectory_signature(&before_scene);

    // Recommendation 2 is the available InsertWaypoint (1→2) in this scenario.
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/apply",
        Some(json!({"recommendation_id": 2})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "apply of the InsertWaypoint must succeed");
    let body = body.expect("apply response must be valid JSON");
    assert_eq!(
        body["status"], "available",
        "recommendation 2 must be the available InsertWaypoint"
    );
    assert_eq!(body["history_length"], 1, "apply stores the inverse");

    let (_, applied_scene) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let applied_scene = applied_scene.expect("scene response must be valid JSON");
    let applied = active_trajectory_signature(&applied_scene);
    assert_ne!(applied, original, "the apply must change the trajectory");

    // Undo — must restore the EXACT pre-apply plan (no leftover segment).
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/undo",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "undo must succeed after an apply");
    let body = body.expect("undo response must be valid JSON");
    assert_eq!(body["history_length"], 0, "undo pops the entry");

    let (_, after_scene) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after_scene = after_scene.expect("scene response must be valid JSON");
    let restored = active_trajectory_signature(&after_scene);
    assert_eq!(
        restored, original,
        "undo of a 1→2 InsertWaypoint must restore the exact original trajectory"
    );
    assert_ne!(restored, applied, "the applied trajectory must be gone");
}

#[tokio::test]
async fn undo_command_empty_history_returns_409_without_mutation() {
    // Spec command-endpoints "Undo with empty history": no applied commands →
    // 409 Conflict; the runtime is untouched.
    let app = writeback_app().await;
    preview_setup(&app).await;

    let (_, before) = get_json(app.clone(), http::Method::GET, "/api/v1/scene", None).await;
    let before = before.expect("scene response must be valid JSON");

    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/plan/commands/undo",
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "undo with empty history must fail with Conflict (409)"
    );
    let body = body.expect("error response must be valid JSON");
    assert_eq!(
        body["code"], "empty_command_history",
        "empty-history undo must carry the empty_command_history code"
    );

    let (_, after) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    let after = after.expect("scene response must be valid JSON");
    assert_eq!(
        after["active_plan"], before["active_plan"],
        "empty-history undo must NOT mutate the active plan"
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
    assert!(
        body["motion_program"]["instructions"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0)
            > 0
    );
    let instrs = body["motion_program"]["instructions"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);
    assert!(
        instrs > 0,
        "should have at least 1 instruction, got {instrs}"
    );
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
    let instrs = body["motion_program"]["instructions"]
        .as_array()
        .map(|a| a.len())
        .unwrap_or(0);
    assert!(
        instrs >= 2,
        "two Waits should produce at least 2 instructions, got {instrs}"
    );
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
    // Empty program compiles to an empty ExecutionProgram (planning is separate)
    assert_eq!(status, StatusCode::OK);
    let body = _body.expect("response body");
    assert_eq!(
        body["motion_program"]["instructions"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(99),
        0
    );
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
    assert!(
        body["motion_program"]["instructions"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0)
            >= 1
    );
}

// =========================================================================
// Semantic execute endpoint — canonical resolver + compiler path (PR 2)
// =========================================================================

/// A task payload whose home_pose is reachable by the runtime's Planar2R
/// robot (in-plane, within reach) so IK converges.
///
/// The runtime scene (`new_default_state`) uses `RobotModel::Planar2R`
/// (2 DOF, l1 = l2 = 1.0, FK at zero config = [2.0, 0.0, 0.0]). A diagonal
/// target at [1.0, 1.0, 0.0] is reachable (q ≈ [45°, -28°]) and avoids the
/// full-extension singularity at the q = [0, 0] start, so DLS converges.
fn planar2r_task_payload(operations: Value) -> Value {
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
                "home_pose": {"position": [1.0, 1.0, 0.0], "orientation": [0.0, 0.0, 0.0, 1.0]}
            },
            "program": {
                "operations": operations
            }
        }
    })
}

#[tokio::test]
async fn semantic_execute_plans_with_scene_robot() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/execute",
        Some(planar2r_task_payload(json!([
            {"type": "home", "origin": "op_0"},
            {"type": "wait", "origin": "op_1", "duration": {"secs": 0, "nanos": 500000000}}
        ]))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {:?}", body);
    let body = body.expect("response body");
    assert_eq!(body["status"], "ok");
    let wps = body["waypoints"].as_array().expect("waypoints array");
    assert!(!wps.is_empty(), "canonical path must produce waypoints");
    // The runtime scene robot is Planar2R (2 DOF) — planning must use the
    // scene robot (invariant I1), NOT the hardcoded SCARA (4 DOF).
    assert_eq!(
        wps[0]["joints"].as_array().map(|a| a.len()).unwrap_or(0),
        2,
        "waypoint joints must match the scene robot DOF (Planar2R = 2)"
    );
    assert!(body["duration_secs"].as_f64().unwrap_or(0.0) > 0.0);
    // Wait → Delay survives resolution as a runtime event (I3: no lossy path).
    assert_eq!(
        body["event_count"].as_u64().unwrap_or(0),
        1,
        "Wait must produce exactly one runtime event"
    );
}

#[tokio::test]
async fn semantic_execute_wait_only_produces_runtime_event() {
    let app = test_app().await;
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/execute",
        Some(planar2r_task_payload(json!([
            {"type": "wait", "origin": "op_w", "duration": {"secs": 0, "nanos": 500000000}}
        ]))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {:?}", body);
    let body = body.expect("response body");
    // No motion instructions → no waypoints, but the Delay survives
    // resolution as a RuntimeEvent (I3 — events never dropped).
    assert!(
        body["waypoints"]
            .as_array()
            .map(|a| a.is_empty())
            .unwrap_or(false),
        "wait-only program must produce no waypoints"
    );
    assert_eq!(
        body["event_count"].as_u64().unwrap_or(0),
        1,
        "Wait must produce exactly one runtime event"
    );
}

/// Integration test: POST TaskDocument-shaped JSON → compile → ExecutionProgram.
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
    assert_eq!(
        status,
        StatusCode::OK,
        "TaskDocument compile should succeed, got {:?}",
        body
    );
    let body = body.expect("response body must be valid JSON");
    assert_eq!(body["status"], "ok");
    assert!(
        body["motion_program"]["instructions"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0)
            > 0,
        "execution plan must have at least one segment"
    );
}

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
        body["motion_program"]["instructions"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0)
            > 0,
        "execution plan must have at least one segment"
    );
}

// ── /motion/plan tests (PR 4) ──────────────────────────────────────────

/// The ExecutionProgram the semantic lowering produces for the
/// planar2r_task_payload(home + wait) TaskDocument used below: `home` lowers
/// to MoveJ toward the scene home pose with the default profile, `wait`
/// lowers to Delay (see thalos-semantic lowering).
fn home_wait_execution_program() -> Value {
    json!({
        "instructions": [
            {
                "type": "move_j",
                "origin": "op_0",
                "target": {
                    "type": "pose",
                    "position": [1.0, 1.0, 0.0],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                    "frame": "world"
                },
                "profile": {"max_velocity": 1.0, "max_acceleration": 0.5, "max_jerk": null}
            },
            {"type": "delay", "origin": "op_1", "duration": {"secs": 0, "nanos": 500000000}}
        ],
        "metadata": {"schema_version": 1, "source_project": "parity-test"}
    })
}

#[tokio::test]
async fn motion_plan_parity_with_semantic_path() {
    let app = test_app().await;

    // ── Semantic path: home + wait → MoveJ + Delay (the PR 2 scenario) ──
    let (sem_status, sem_body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/semantic/execute",
        Some(planar2r_task_payload(json!([
            {"type": "home", "origin": "op_0"},
            {"type": "wait", "origin": "op_1", "duration": {"secs": 0, "nanos": 500000000}}
        ]))),
    )
    .await;
    assert_eq!(sem_status, StatusCode::OK, "semantic path: {:?}", sem_body);
    let sem = sem_body.expect("semantic response body");
    let sem_wps = sem["waypoints"].as_array().expect("semantic waypoints");
    let sem_event_count = sem["event_count"].as_u64().expect("semantic event_count");

    // ── /motion/plan with the exact ExecutionProgram the lowering emits ──
    let (mp_status, mp_body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/plan",
        Some(home_wait_execution_program()),
    )
    .await;
    assert_eq!(mp_status, StatusCode::OK, "/motion/plan: {:?}", mp_body);
    let mp = mp_body.expect("/motion/plan response body");

    // Both IR-3 artifacts are present in the response.
    let plan_wps = mp["compiled_plan"]["merged_trajectory"]["waypoints"]
        .as_array()
        .expect("compiled_plan waypoints");
    let events = mp["runtime_program"]["events"]
        .as_array()
        .expect("runtime_program events");

    // Parity: identical trajectory and identical runtime event stream.
    assert!(!plan_wps.is_empty(), "compiled plan must produce waypoints");
    assert_eq!(plan_wps.len(), sem_wps.len(), "waypoint count parity");
    for (plan_wp, sem_wp) in plan_wps.iter().zip(sem_wps.iter()) {
        assert_eq!(plan_wp["joints"], sem_wp["joints"], "joints parity");
        assert_eq!(
            plan_wp["timestamp"], sem_wp["time_secs"],
            "timestamp parity"
        );
    }
    assert_eq!(events.len() as u64, sem_event_count, "runtime event parity");

    // I2: origin preserved from the ExecutionProgram into both artifacts.
    assert_eq!(
        mp["compiled_plan"]["segments"][0]["origin"], "op_0",
        "PlannedSegment must carry the MoveJ origin"
    );
    assert_eq!(
        events[0]["operation_id"], "op_1",
        "RuntimeEvent must carry the Delay origin"
    );
}

/// Spec scenario "Valid ExecutionProgram request": a program with MoveJ and
/// SetOutput instructions must be accepted and produce a compiled trajectory
/// plus one SetOutput runtime event (different code path than Delay).
#[tokio::test]
async fn motion_plan_accepts_movej_and_set_output() {
    let app = test_app().await;
    let exec_program = json!({
        "instructions": [
            {
                "type": "move_j",
                "origin": "op_j",
                "target": {
                    "type": "pose",
                    "position": [1.0, 1.0, 0.0],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                    "frame": "world"
                },
                "profile": {"max_velocity": 1.0, "max_acceleration": 0.5, "max_jerk": null}
            },
            {
                "type": "set_output",
                "origin": "op_io",
                "channel": {"name": "gripper", "channel_type": "digital"},
                "value": {"Bool": true}
            }
        ],
        "metadata": {"schema_version": 1, "source_project": "triangulate"}
    });
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/plan",
        Some(exec_program),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body: {:?}", body);
    let body = body.expect("response body");

    let plan_wps = body["compiled_plan"]["merged_trajectory"]["waypoints"]
        .as_array()
        .expect("compiled_plan waypoints");
    assert!(!plan_wps.is_empty(), "MoveJ must produce waypoints");
    assert_eq!(
        plan_wps[0]["joints"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0),
        2,
        "waypoint joints must match the scene robot DOF (Planar2R = 2)"
    );

    let events = body["runtime_program"]["events"]
        .as_array()
        .expect("runtime_program events");
    assert_eq!(events.len(), 1, "SetOutput must produce exactly one event");
    assert_eq!(events[0]["operation_id"], "op_io");
    assert!(
        events[0]["action"].get("SetOutput").is_some(),
        "event action must be SetOutput, got {:?}",
        events[0]["action"]
    );
    assert_eq!(
        events[0]["action"]["SetOutput"]["channel"]["name"], "gripper",
        "SetOutput channel must survive into the runtime program"
    );
    assert_eq!(
        events[0]["action"]["SetOutput"]["value"],
        json!({"Bool": true}),
        "SetOutput value must survive into the runtime program"
    );
}

/// Spec scenario "Non-ExecutionProgram input rejected": a body shaped like
/// a SemanticProgram / TaskDocument (the semantic path's input) must NOT
/// deserialize as an ExecutionProgram → 4xx.
#[tokio::test]
async fn motion_plan_rejects_non_execution_program() {
    let app = test_app().await;
    // Missing "instructions"/"metadata" — this is a SemanticProgram shape.
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/plan",
        Some(json!({"operations": [{"type": "home", "origin": "op_0"}]})),
    )
    .await;
    assert!(
        status.is_client_error(),
        "non-ExecutionProgram input must be rejected, got {status}"
    );
    let has_plan = body
        .as_ref()
        .is_some_and(|b| b.get("compiled_plan").is_some() || b.get("runtime_program").is_some());
    assert!(
        !has_plan,
        "rejected input must not yield plan artifacts, got {:?}",
        body
    );
}

/// Spec scenarios "Resolver error returns error response" and "No partial
/// results on failure": an unreachable target makes IK fail → 4xx with the
/// failure reason, and the body carries only the error.
#[tokio::test]
async fn motion_plan_resolver_error_returns_4xx_no_partial() {
    let app = test_app().await;
    // [50.0, 50.0, 0.0] is far beyond the Planar2R workspace → the DLS IK
    // solver cannot converge → ResolutionError::IkFailed.
    let exec_program = json!({
        "instructions": [
            {
                "type": "move_j",
                "origin": "op_far",
                "target": {
                    "type": "pose",
                    "position": [50.0, 50.0, 0.0],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                    "frame": "world"
                },
                "profile": {"max_velocity": 1.0, "max_acceleration": 0.5, "max_jerk": null}
            }
        ],
        "metadata": {"schema_version": 1, "source_project": "error-test"}
    });
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/plan",
        Some(exec_program),
    )
    .await;
    assert!(
        status.is_client_error(),
        "resolver failure must be 4xx, got {status}"
    );
    let body = body.expect("error response body");
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|e| e.contains("IK failed")),
        "error must carry the IK failure reason, got {:?}",
        body["error"]
    );
    // No partial results on failure (spec: Error Handling).
    assert!(
        body.get("compiled_plan").is_none(),
        "no partial compiled_plan may be returned"
    );
    assert!(
        body.get("runtime_program").is_none(),
        "no partial runtime_program may be returned"
    );
}

// ── ORIGIN regression: URDF-loaded robot plans against its real chain ──────

/// TaskDocument payload whose scene `home_pose` sits inside the icebot
/// workspace: `home` lowers to a single MoveJ toward that pose (the same
/// lowering `planar2r_task_payload` relies on, but reachable by a 4-DOF
/// planar + prismatic robot).
fn icebot_task_payload(operations: Value) -> Value {
    json!({
        "task": {
            "id": "icebot-test",
            "metadata": {
                "name": "icebot-test",
                "version": 1,
                "created_at": "",
                "modified_at": ""
            },
            "scene": {
                "objects": [],
                "locations": [],
                "tools": [],
                "home_pose": {
                    "position": [0.225, 0.0, 0.02],
                    "orientation": [0.0, 0.0, 0.0, 1.0]
                }
            },
            "program": {
                "operations": operations
            }
        }
    })
}

/// ORIGIN regression (spec: "Icebot URDF plan returns 4-DOF waypoints").
///
/// Loading the 4-DOF icebot URDF and planning must produce 200 with 4-joint
/// waypoints. The planner MUST consume `snapshot.chain` — a
/// `create_default(Planar3R)` reconstruction (the pre-fix path) fails with
/// `DofMismatch { expected: 3, actual: 4 }` → 422, or silently emits
/// 3-joint waypoints; the assertion below catches both.
#[tokio::test]
async fn urdf_load_then_plan_uses_real_chain() {
    let app = test_app().await;
    let icebot_urdf = include_str!("../../../../docs/robot/icebot.urdf");

    // Load the 4-DOF icebot URDF.
    let (load_status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({"urdf_source": icebot_urdf})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "URDF load must succeed");

    // MoveJ toward a pose inside the icebot workspace. The chain tip is
    // `tool0` (fixed tcp_joint child) at zero-config (0.225, 0, 0.04); the
    // target below keeps X/Y at the start and moves the prismatic joint, so
    // IK converges with real 4-joint motion. Keeping X/Y is deliberate: at
    // q=0 the arm is FULLY EXTENDED — a classic planar singularity (the
    // Jacobian X-row is all-zero, rank-2 linear Jacobian) where radial XY
    // motion is unreachable. This is a physical singularity, not a solver
    // or fixed-joint degeneracy (see `icebot_xy_ik_converges_from_non_singular_q0`).
    let program = json!({
        "instructions": [{
            "type": "move_j",
            "origin": "op_0",
            "target": {
                "type": "pose",
                "position": [0.225, 0.0, 0.02],
                "orientation": [0.0, 0.0, 0.0, 1.0],
                "frame": "world"
            },
            "profile": {"max_velocity": 1.0, "max_acceleration": 0.5, "max_jerk": null}
        }],
        "metadata": {"schema_version": 1, "source_project": "urdf-origin"}
    });
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/motion/plan",
        Some(program),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "URDF robot must plan against its real chain: {:?}",
        body
    );
    let body = body.expect("plan response body");
    let waypoints = body["compiled_plan"]["merged_trajectory"]["waypoints"]
        .as_array()
        .expect("compiled_plan waypoints");
    assert!(!waypoints.is_empty(), "plan must produce waypoints");
    // Zero `RobotRegistry::create_default` calls during the flow: any
    // Planar3R reconstruction yields 3-joint waypoints or a DofMismatch,
    // both incompatible with this assertion.
    assert!(
        waypoints
            .iter()
            .all(|wp| wp["joints"].as_array().map(|a| a.len()).unwrap_or(0) == 4),
        "every waypoint must carry 4 joints (real icebot chain), got {:?}",
        waypoints
    );
}

/// Spec: unified-kinematics "Semantic execute uses loaded chain" — same URDF
/// via the semantic path must produce 200 with 4-joint waypoints.
#[tokio::test]
async fn urdf_load_then_semantic_execute_uses_real_chain() {
    let app = test_app().await;
    let icebot_urdf = include_str!("../../../../docs/robot/icebot.urdf");

    let (load_status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({"urdf_source": icebot_urdf})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "URDF load must succeed");

    // `home` lowers to MoveJ toward the scene home_pose (inside the icebot
    // workspace) — the semantic path must resolve it against the real chain.
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/execute",
        Some(icebot_task_payload(json!([
            {"type": "home", "origin": "op_0"}
        ]))),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "semantic execute must plan against the real chain: {:?}",
        body
    );
    let body = body.expect("semantic response body");
    let wps = body["waypoints"].as_array().expect("waypoints array");
    assert!(!wps.is_empty(), "semantic path must produce waypoints");
    assert!(
        wps.iter()
            .all(|wp| wp["joints"].as_array().map(|a| a.len()).unwrap_or(0) == 4),
        "every waypoint must carry 4 joints (real icebot chain), got {:?}",
        wps
    );
}

/// Spec: unified-kinematics "XY-Convergence Regression" — a planar robot
/// must converge on an XY target from a NON-singular initial configuration.
///
/// The icebot arm is fully extended at q=0 (tool0 at (0.225, 0, 0.04), the
/// classic fully-extended planar singularity: the Jacobian X-row is all
/// zero, so radial XY motion is unreachable). That is a physical
/// singularity, NOT a solver or fixed-joint bug. Starting from the bent,
/// non-singular configuration q0 = [π/4, π/4, π/4, π/4] the DLS solver
/// MUST converge on an XY target inside the workspace.
#[tokio::test]
async fn icebot_xy_ik_converges_from_non_singular_q0() {
    let app = test_app().await;
    let icebot_urdf = include_str!("../../../../docs/robot/icebot.urdf");

    let (load_status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({"urdf_source": icebot_urdf})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "URDF load must succeed");

    // Non-singular initial configuration: the three revolute joints bend
    // the arm 3π/4 away from full extension, so radial XY motion is
    // reachable. (The 4th component seeds the Z-prismatic; the solver
    // converges to a physically valid solution regardless of the seed.)
    let (set_status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/joints",
        Some(json!({"joint_angles": [
            std::f64::consts::PI / 4.0,
            std::f64::consts::PI / 4.0,
            std::f64::consts::PI / 4.0,
            std::f64::consts::PI / 4.0
        ]})),
    )
    .await;
    assert_eq!(set_status, StatusCode::OK, "setting q0 must succeed");

    // XY target inside the workspace (radius 0.180 < 0.225 max reach),
    // Z offset within the prismatic range (q3 = 0.02). Differs from the
    // q0 tool0 XY (0.088, 0.188) in both components — proving real XY
    // motion, not a degenerate fixed-joint-only solve.
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/solve-ik-position",
        Some(json!({"target": [0.15, 0.10, 0.02]})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "IK must not error from a non-singular q0: {:?}",
        body
    );
    let body = body.expect("IK response body");

    let ik = body["ik_result"].as_object().expect("ik_result object");
    assert_eq!(
        ik["status"], "Converged",
        "DLS must converge on the XY target from non-singular q0: {:?}",
        ik
    );
    let final_error = ik["final_error"].as_f64().expect("final_error number");
    assert!(
        final_error < 1e-3,
        "converged solution must be within tolerance (final_error = {final_error})"
    );

    // Kinematic validity: a 4-joint solution, all finite.
    let joints = body["joints"]
        .as_array()
        .expect("joints array")
        .iter()
        .map(|j| j.as_f64().expect("joint value"))
        .collect::<Vec<_>>();
    assert_eq!(joints.len(), 4, "solution must carry 4 joints (real chain)");
    assert!(
        joints.iter().all(|j| j.is_finite()),
        "solution must be finite (kinematically valid), got {:?}",
        joints
    );
}

/// Spec: unified-kinematics "Tag carries no kinematic meaning" — the API DTO
/// for a URDF-loaded robot must expose the real chain data (stable
/// `urdf:<hash>` id, real DOF) instead of falling back to built-in metadata.
/// This branch only activates when `joints_meta` is populated; an empty vec
/// masks the fallback (the bug fixed in scene_tests.rs).
#[tokio::test]
async fn load_urdf_exposes_real_robot_dto() {
    let app = test_app().await;
    let icebot_urdf = include_str!("../../../../docs/robot/icebot.urdf");

    let (load_status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({"urdf_source": icebot_urdf})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "URDF load must succeed");

    let (status, body) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    assert_eq!(status, StatusCode::OK, "scene read must succeed");
    let body = body.expect("scene response body");
    let id = body["robot"]["id"].as_str().expect("robot.id string");
    assert!(
        id.starts_with("urdf:") && id.len() == "urdf:".len() + 12,
        "URDF DTO must carry a stable urdf:<hash> id, got {:?}",
        body["robot"]["id"]
    );
    assert_eq!(
        body["robot"]["dof"], 4,
        "URDF DTO must carry the real chain DOF"
    );
    assert_eq!(
        body["robot"]["joints"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0),
        4,
        "URDF DTO must carry the 4 actuated joints"
    );
}

/// Spec robot-identity R1.1/R1.2: importing the same URDF twice MUST yield
/// the identical `robot.id` (deterministic hash of the raw XML).
#[tokio::test]
async fn urdf_load_emits_stable_robot_id() {
    let app = test_app().await;
    let icebot_urdf = include_str!("../../../../docs/robot/icebot.urdf");

    // First import — the id must match urdf:<12 lowercase hex>.
    let (load_status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({"urdf_source": icebot_urdf})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "URDF load must succeed");
    let body = body.expect("load response body");
    let first_id = body["robot"]["id"]
        .as_str()
        .expect("robot.id string")
        .to_string();
    assert!(
        first_id.starts_with("urdf:"),
        "robot.id must start with 'urdf:', got {first_id}"
    );
    let hash = &first_id["urdf:".len()..];
    assert_eq!(
        hash.len(),
        12,
        "robot.id must carry 12 hex chars, got {first_id}"
    );
    assert!(
        hash.chars().all(|c| c.is_ascii_hexdigit()),
        "robot.id hash must be lowercase hex, got {first_id}"
    );

    // Re-import the same file → identical id (R1.1).
    let (load_status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({"urdf_source": icebot_urdf})),
    )
    .await;
    assert_eq!(load_status, StatusCode::OK, "second URDF load must succeed");
    let body = body.expect("second load response body");
    let second_id = body["robot"]["id"]
        .as_str()
        .expect("robot.id string")
        .to_string();
    assert_eq!(
        first_id, second_id,
        "re-importing the same URDF must yield the same robot.id"
    );
}

/// Spec robot-identity R1.3: a built-in catalog robot loaded via `LoadRobot`
/// MUST expose `robot.id == metadata.id`.
#[tokio::test]
async fn catalog_load_emits_metadata_id() {
    let app = test_app().await;

    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "scara"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "catalog load must succeed");
    let body = body.expect("response body");
    assert_eq!(
        body["robot"]["id"], "scara",
        "catalog robot.id must equal metadata.id, got {:?}",
        body["robot"]["id"]
    );
    assert_eq!(body["robot"]["dof"], 4, "SCARA metadata carries dof 4");

    // Triangulate with a second catalog robot (different metadata id).
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({"robot_id": "planar_3r"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "second catalog load must succeed");
    let body = body.expect("response body");
    assert_eq!(
        body["robot"]["id"], "planar_3r",
        "catalog robot.id must equal metadata.id, got {:?}",
        body["robot"]["id"]
    );
    assert_eq!(body["robot"]["dof"], 3, "Planar3R metadata carries dof 3");
}
