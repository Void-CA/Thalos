use axum::{
    body::Body,
    http::{self, Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use tower::ServiceExt;

use thalos_api::{app_router, new_default_state};

fn test_app() -> Router {
    let state = new_default_state();
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
    let app = test_app();
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    // response is wrapped: { scene: VisualScene, generated_at }
    assert!(body.get("scene").is_some(), "response must contain 'scene' wrapper");
    assert!(body.get("generated_at").is_some(), "response must contain 'generated_at'");

    let scene = &body["scene"];
    assert!(scene.get("frames").is_some(), "scene must contain frames");
    let frames = scene["frames"].as_array().unwrap();
    let has_world = frames.iter().any(|f| f["id"] == "world");
    assert!(has_world, "scene must contain world frame");
}

#[tokio::test]
async fn from_fk_returns_wrapped_scene() {
    let app = test_app();
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({"joint_angles": [0.5, 0.3]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    assert!(body.get("scene").is_some(), "response must contain 'scene' wrapper");
    assert!(body.get("generated_at").is_some(), "response must contain 'generated_at'");

    let scene = &body["scene"];
    assert!(scene.get("frames").is_some());
    let frames = scene["frames"].as_array().unwrap();
    assert!(frames.len() >= 3, "planar_2r should have world + 2 links");
}

#[tokio::test]
async fn from_fk_rejects_nan() {
    let app = test_app();
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
    let app = test_app();
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({"state": [0.5, 0.3]})),
    )
    .await;
    assert!(status.is_client_error(), "missing joint_angles should be rejected");
}

// ── Validation tests ──

#[tokio::test]
async fn validate_valid_scene() {
    let app = test_app();
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
    let app = test_app();
    let invalid = json!({
        "frames": [],
        "links": [],
        "joint_axes": [],
        "twists": []
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
    assert!(body.get("code").is_some(), "error response must contain 'code'");
    assert_eq!(body["code"], "MISSING_WORLD");
    assert!(body["error"].as_str().unwrap().contains("world"));
}

// ── Diff tests ──

#[tokio::test]
async fn diff_identical_scenes() {
    let app = test_app();
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
    let app = test_app();
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
    assert!(!changed.is_empty(), "different configurations should produce changes");
}

// ── Error mapping tests ──

#[tokio::test]
async fn error_code_missing_world() {
    let app = test_app();
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/scene/validate",
        Some(json!({"scene": {
            "frames": [],
            "links": [],
            "joint_axes": [],
            "twists": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "MISSING_WORLD");
}

#[tokio::test]
async fn error_code_duplicate_id() {
    let app = test_app();
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
            "twists": []
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
    let app = test_app();
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
            "twists": []
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
    let app = test_app();
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
            "twists": []
        }})),
    )
    .await;
    assert!(status.is_client_error());
    // NaN may be rejected by serde before reaching handler,
    // so only check it's a client error
}

#[tokio::test]
async fn error_code_invalid_quaternion() {
    let app = test_app();
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
            "twists": []
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
    let app = test_app();
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
            "twists": []
        }})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("error response");
    assert_eq!(body["code"], "BROKEN_TOPOLOGY");
}

#[tokio::test]
async fn error_code_orphan_link() {
    let app = test_app();
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
                {"start": [0,0,0], "end": [1,0,0]},
                {"start": [5,0,0], "end": [10,0,0]}
            ],
            "joint_axes": [],
            "twists": []
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
    let app = test_app();
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
    let app = test_app();
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/scara", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"].as_array().expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 4, "SCARA should have 4 joints");

    let first = &joints[0];
    assert!(first.get("name").is_some(), "each joint must have a name");
    assert!(first.get("kind").is_some(), "each joint must have a kind");
    assert!(first.get("min").is_some(), "each joint must have min (may be null)");
    assert!(first.get("max").is_some(), "each joint must have max (may be null)");

    assert_eq!(body["dof"].as_u64().unwrap() as usize, joints.len(), "dof must equal joints.len()");
}

#[tokio::test]
async fn get_robot_planar_2r_returns_joints() {
    let app = test_app();
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/planar_2r", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"].as_array().expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 2, "Planar2R should have 2 joints");
    assert_eq!(body["dof"].as_u64().unwrap() as usize, joints.len(), "dof must equal joints.len()");
}

#[tokio::test]
async fn get_robot_planar_3r_returns_joints() {
    let app = test_app();
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/planar_3r", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"].as_array().expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 3, "Planar3R should have 3 joints");
    assert_eq!(body["dof"].as_u64().unwrap() as usize, joints.len(), "dof must equal joints.len()");
}

#[tokio::test]
async fn get_robot_single_revolute_returns_joints() {
    let app = test_app();
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots/single_revolute", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");

    let joints = body["joints"].as_array().expect("response must contain 'joints' array");
    assert_eq!(joints.len(), 1, "SingleRevolute should have 1 joint");
    assert_eq!(body["dof"].as_u64().unwrap() as usize, joints.len(), "dof must equal joints.len()");
}

#[tokio::test]
async fn list_robots_returns_all_with_joints() {
    let app = test_app();
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/robots", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let robots = body.as_array().expect("response must be an array");
    assert_eq!(robots.len(), 4, "should have 4 robots");

    for robot in robots {
        let joints = robot["joints"].as_array().expect("each robot must have joints array");
        let dof = robot["dof"].as_u64().unwrap() as usize;
        assert_eq!(dof, joints.len(), "dof must equal joints.len() for {}", robot["id"]);
    }
}

#[tokio::test]
async fn scara_joint_kinds_include_prismatic() {
    let app = test_app();
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
