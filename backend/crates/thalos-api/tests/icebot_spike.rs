//! Slice 0 — Icebot spike gate (design D7).
//!
//! Proves the full showcase path on icebot: `docs/execution/robot/icebot.urdf` →
//! parse_robot + SerialChain → FK → IK(home) → semantic Pick/Place lowering
//! producing a valid motion through the existing pipeline (POST /semantic/
//! execute). GATE: a failing stage means the demos fall back to scara
//! (spec `icebot-showcase`); the test fails loudly, never silently degrades.
//!
//! Spike findings (recorded 2026-08-14):
//! - icebot FK([0,0,0,0]) is FULL EXTENSION (max XY reach 0.225 m, 2-link
//!   arm) — a singular start for the DLS solver → MaxIterations. The demo
//!   must use a bent seed home (pattern already used by the SCARA demo:
//!   seed `[0,-1.31,-0.1,0]`).
//! - icebot axis_1 limit [0, 2.0944] bounds reachable radius to ≥ ~0.115 m;
//!   pick/place poses must sit inside the reachable annulus.

use axum::{
    Router,
    body::Body,
    http::{self, Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

use thalos_api::{app_router, new_default_state};

const ICEBOT_URDF: &str = include_str!("../../../../docs/execution/robot/icebot.urdf");

/// Non-singular seed home for icebot (FK(0) is full extension — unusable).
const ICEBOT_SEED: [f64; 4] = [0.5, 0.8, 0.5, 0.02];

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

/// TCP position of the active chain at the given joint angles (finite check).
async fn tcp_at(app: &Router, joints: &[f64]) -> Vec<f64> {
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({ "joint_angles": joints })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "from-fk must succeed");
    let frames = body
        .expect("fk response must be JSON")["scene"]["frames"]
        .as_array()
        .expect("scene must contain frames")
        .clone();
    let tcp: Vec<f64> = frames
        .last()
        .unwrap()["translation"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    assert!(tcp.iter().all(|v| v.is_finite()), "TCP must be finite: {tcp:?}");
    tcp
}

/// Semantic Pick/Place/Home TaskDocument for the given home + pick poses.
fn pick_place_task(home: &[f64], box_pos: [f64; 3], tray_pos: [f64; 3]) -> Value {
    json!({
        "task": {
            "id": "spike",
            "metadata": {
                "name": "spike",
                "version": 1,
                "created_at": "2026-08-14T00:00:00Z",
                "modified_at": "2026-08-14T00:00:00Z",
            },
            "scene": {
                "objects": [{
                    "id": "box-1",
                    "name": "Box-1",
                    "category": null,
                    "pose": { "position": box_pos, "orientation": [0.0, 0.0, 0.0, 1.0] },
                }],
                "locations": [{
                    "id": "tray-1",
                    "name": "Tray-1",
                    "description": null,
                    "pose": { "position": tray_pos, "orientation": [0.0, 0.0, 0.0, 1.0] },
                }],
                "tools": [],
                "home_pose": { "position": home, "orientation": [0.0, 0.0, 0.0, 1.0] },
                // D6 (commit c642195) made the SceneContent approach_height
                // serde-default 0.05 (scara-oriented web default). Icebot's
                // reachable tool0 z-band is [-0.02, 0.04] (Slice 0 finding), so
                // 0.05 pushes the approach/retreat transit frames out of reach
                // → IK MaxIterations. Icebot demos MUST set approach_height
                // explicitly; 0.02 is the physically-correct value for the band.
                "approach_height": 0.02,
            },
            "program": {
                "operations": [
                    { "type": "pick", "origin": "op-1", "object": "box-1", "tool": null },
                    { "type": "place", "origin": "op-2", "object": "box-1", "destination": "tray-1", "tool": null },
                    { "type": "home", "origin": "op-3" },
                ]
            },
        }
    })
}

/// Icebot spike gate — full path URDF → FK → IK → semantic lowering.
#[tokio::test]
async fn icebot_spike_full_path() {
    // 1. URDF load → SerialChain (spec: "Icebot URDF loads").
    let app = test_app().await;
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot/from-urdf",
        Some(json!({ "urdf_source": ICEBOT_URDF })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "icebot.urdf must load via parse_robot + SerialChain (fixed tcp_joint, prismatic axis_3)"
    );
    let body = body.expect("load response must be JSON");
    assert!(
        body["robot"]["id"].as_str().unwrap_or("").starts_with("urdf:"),
        "loaded robot must carry a urdf: identity"
    );
    assert_eq!(body["robot"]["dof"], 4, "icebot = 3 revolute + 1 prismatic");
    assert_eq!(body["joints"].as_array().unwrap().len(), 4);

    // 2. FK(0) valid (spec) + move to the non-singular seed demo home.
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({ "joint_angles": [0.0, 0.0, 0.0, 0.0] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "FK(0) must be computable on icebot");
    let home = tcp_at(&app, &ICEBOT_SEED).await;

    // 3. IK converges on home pose (spec). The 3R arm has multiple valid
    // preimages (mirrored elbow) — assert the solution REACHES home.
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/solve-ik-pose",
        Some(json!({
            "target": {
                "translation": home,
                "rotation": { "kind": "Quaternion", "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 } }
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "solve-ik-pose must run on icebot");
    let body = body.expect("ik response must be JSON");
    assert_eq!(
        body["ik_result"]["status"], "Converged",
        "IK must converge on the demo home pose"
    );
    let solved: Vec<f64> = body["joints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    let reached = tcp_at(&app, &solved).await;
    for (i, v) in reached.iter().enumerate() {
        assert!(
            (v - home[i]).abs() < 1e-3,
            "IK solution must reach the home pose at axis {i}: got {v}, want {}",
            home[i]
        );
    }

    // 4. Semantic Pick/Place lowering → valid motion (design D7). The
    // LOADED icebot chain drives lowering + DLS IK + planning; poses inside
    // the reachable annulus (axis_1 limit, radius ≥ ~0.115 m).
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/semantic/execute",
        Some(pick_place_task(&home, [0.15, 0.05, 0.02], [0.15, 0.10, 0.02])),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "semantic Pick/Place must produce a valid motion on icebot (lowering + DLS IK against the loaded chain): {body:?}"
    );
    let body = body.expect("execute response must be JSON");
    assert_eq!(body["status"], "ok");
    assert!(
        body["segment_count"].as_u64().unwrap() >= 6,
        "pick + place + home must plan at least 6 segments (a pick alone is 5)"
    );
    assert!(
        body["waypoints"].as_array().unwrap().len() >= 2,
        "compiled trajectory must carry waypoints"
    );

    // The plan is scheduled into the runtime bound to the icebot chain.
    let (status, body) = get_json(app, http::Method::GET, "/api/v1/scene", None).await;
    assert_eq!(status, StatusCode::OK);
    let body = body.expect("scene response must be JSON");
    let active_segments = body
        .get("active_plan")
        .and_then(|p| p.get("segments"))
        .and_then(|s| s.as_array())
        .expect("runtime must hold the scheduled icebot plan");
    assert!(
        active_segments.len() >= 6,
        "runtime plan must contain the icebot pick/place/home segments"
    );
}

/// Fallback probe (spec: "Fallback to scara") — the SAME pipeline must
/// produce a valid Pick/Place motion on scara (canonical demo seed + poses,
/// web fixture `scara-pick-place-home.ts`).
#[tokio::test]
async fn scara_fallback_full_path() {
    let app = test_app().await;
    let (status, body) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/robot",
        Some(json!({ "robot_id": "scara" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "scara must load");
    assert_eq!(body.expect("load response")["robot"]["dof"], 4);
    let (status, _) = get_json(
        app.clone(),
        http::Method::POST,
        "/api/v1/scene/from-fk",
        Some(json!({ "joint_angles": [0.0, -1.31, -0.1, 0.0] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "scara seed joints must set");

    let (status, body) = get_json(
        app,
        http::Method::POST,
        "/api/v1/semantic/execute",
        Some(pick_place_task(&[1.206280, -0.772948, 0.4], [1.240459, 1.192391, 0.35], [1.429181, -0.100004, 0.35])),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "scara fallback must produce a valid motion through the same semantic pipeline: {body:?}"
    );
    let body = body.expect("execute response must be JSON");
    assert_eq!(body["status"], "ok");
    assert!(
        body["segment_count"].as_u64().unwrap() >= 6,
        "scara pick + place + home must plan real segments"
    );
}
