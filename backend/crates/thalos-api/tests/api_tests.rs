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

#[tokio::test]
async fn get_scene_returns_scene_with_world() {
    let app = test_app();
    let (status, body) = get_json(app, http::Method::GET, "/api/scene", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    assert!(body.get("frames").is_some(), "response must contain frames");
    let frames = body["frames"].as_array().unwrap();
    let has_world = frames.iter().any(|f| f["id"] == "world");
    assert!(has_world, "scene must contain world frame");
}

#[tokio::test]
async fn from_fk_returns_scene() {
    let app = test_app();
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/scene/from-fk",
        Some(json!({"joint_angles": [0.5, 0.3]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    assert!(body.get("frames").is_some());
    let frames = body["frames"].as_array().unwrap();
    assert!(frames.len() >= 3, "planar_2r should have world + 2 links");
}

#[tokio::test]
async fn from_fk_rejects_nan() {
    let app = test_app();
    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/scene/from-fk",
        Some(json!({"joint_angles": [f64::NAN, 0.0]})),
    )
    .await;
    assert!(status.is_client_error(), "NaN should be rejected");
    assert!(body.is_none() || body.as_ref().is_some_and(|v| v.get("frames").is_none()));
}

#[tokio::test]
async fn from_fk_rejects_missing_field() {
    let app = test_app();
    let (status, _body) = get_json(
        app,
        http::Method::POST,
        "/api/scene/from-fk",
        Some(json!({"state": [0.5, 0.3]})),
    )
    .await;
    assert!(status.is_client_error(), "missing joint_angles should be rejected");
}

#[tokio::test]
async fn validate_valid_scene() {
    let app = test_app();
    let (_, body) = get_json(app.clone(), http::Method::GET, "/api/scene", None).await;
    let scene = body.expect("valid scene response");

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/scene/validate",
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
        "/api/scene/validate",
        Some(json!({"scene": invalid})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let body = body.expect("response must be valid JSON");
    assert_eq!(body["valid"], false);
    assert!(body["error"].as_str().unwrap().contains("world"));
}

#[tokio::test]
async fn diff_identical_scenes() {
    let app = test_app();
    let (_, body) = get_json(app.clone(), http::Method::GET, "/api/scene", None).await;
    let scene = body.expect("valid scene");

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/scene/diff",
        Some(json!({"old": scene.clone(), "new": scene, "epsilon": 1e-6})),
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
        "/api/scene/from-fk",
        Some(q0),
    )
    .await;
    let old = body.expect("valid scene");

    let (_, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/scene/from-fk",
        Some(q1),
    )
    .await;
    let new = body.expect("valid scene");

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/scene/diff",
        Some(json!({"old": old, "new": new, "epsilon": 1e-6})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("response must be valid JSON");
    let changed = body["changed_frames"].as_array().unwrap();
    assert!(!changed.is_empty(), "different configurations should produce changes");
}
