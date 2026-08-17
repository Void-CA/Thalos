//! Shared demo execution logic for evidence export.
//!
//! Extracted from `tests/demos_reproducibility.rs` so both the test harness
//! and the `evidence_export` binary can drive the 4 canonical demos
//! headless (in-process via axum `Router`, no real HTTP) and collect the
//! full `PlanAnalysisResponse` for each.

use axum::{
    Router,
    body::Body,
    http::{self, Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt as _;

use thalos_document::scene_file::SceneFile;
use thalos_semantic::script;

const ICEBOT_URDF: &str =
    include_str!("../../../../docs/execution/robot/icebot.urdf");

/// Repo `demos/` root — the default `THALOS_DEMOS_ROOT` (`./demos`).
pub const DEMOS_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../demos");

/// `THALOS_DEMOS_ROOT` is process-global — serialize on a mutex so env
/// changes never race across parallel tests.
pub static DEMOS_ROOT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Wire evidence of one demo run: execute + analyze outcomes.
pub struct DemoEvidence {
    pub demo_id: &'static str,
    pub execute_status: StatusCode,
    pub execute_body: Option<Value>,
    pub segment_count: Option<u64>,
    pub analyze_status: StatusCode,
    pub analyze_body: Option<Value>,
    pub ranking: Option<Value>,
}

/// Closed-form bent start for icebot's 2-link arm (L1 = 0.125, L2 = 0.100,
/// axis_1 limit [0, 2.0944]) derived from the scene's `home_pose`.
pub fn bent_start_joints(home: &thalos_document::pose::Pose) -> [f64; 4] {
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

async fn get_text(router: Router, path: &str) -> (StatusCode, String) {
    let req = Request::builder()
        .method(http::Method::GET)
        .uri(path)
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&bytes).to_string())
}

/// Run one demo through the REAL pipeline:
/// catalog → scene + program → derive home → compile → execute → analyze.
pub async fn run_demo(app: &Router, demo_id: &'static str) -> DemoEvidence {
    let _guard = DEMOS_ROOT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: serialized by DEMOS_ROOT_LOCK — only holders of the lock
    // mutate THALOS_DEMOS_ROOT.
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
    assert_eq!(
        status,
        StatusCode::OK,
        "program must be servable for {demo_id}"
    );

    // 3. Parse the persisted source artifacts.
    let scene_file: SceneFile =
        serde_json::from_value(scene_body.expect("scene must be JSON"))
            .expect("scene.json must parse as a SceneFile v1");
    let scene = scene_file.clone().into_scene_content();
    let program = script::parse(&program_text)
        .unwrap_or_else(|e| panic!("program.thalos must parse for {demo_id}: {e:?}"));

    // 4. Derive the demo home joints from scene.json's `home_pose`.
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
    assert_eq!(
        status,
        StatusCode::OK,
        "IK must run on the demo home pose"
    );
    let body = body.expect("ik response must be JSON");
    assert_eq!(
        body["ik_result"]["status"],
        "Converged",
        "the demo home must be reachable"
    );
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
    assert_eq!(
        status,
        StatusCode::OK,
        "runtime must start at the demo home"
    );

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

    // 6. Analyze the active plan.
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
        analyze_body,
        ranking,
    }
}

/// Print the observed evidence (reference for the READMEs — NOT asserted).
pub fn print_evidence(evidence: &DemoEvidence) {
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

/// Recursively sort all JSON object keys for deterministic output.
pub fn sort_json_keys(val: &Value) -> Value {
    match val {
        Value::Object(map) => {
            let mut sorted: Vec<_> = map.iter().collect();
            sorted.sort_by_key(|(k, _)| (*k).clone());
            let sorted_map: serde_json::Map<String, Value> = sorted
                .into_iter()
                .map(|(k, v)| (k.clone(), sort_json_keys(v)))
                .collect();
            Value::Object(sorted_map)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_json_keys).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sort_json_keys_recursive() {
        let input = serde_json::json!({
            "z": 1,
            "a": {"m": 2, "b": 3},
            "c": [{"x": 9, "a": 1}]
        });
        let sorted = sort_json_keys(&input);
        let keys: Vec<&str> = sorted.as_object().unwrap().keys().map(|s| s.as_str()).collect();
        assert_eq!(keys, vec!["a", "c", "z"]);

        let inner = sorted["a"].as_object().unwrap();
        let inner_keys: Vec<&str> = inner.keys().map(|s| s.as_str()).collect();
        assert_eq!(inner_keys, vec!["b", "m"]);
    }

    #[test]
    fn sort_json_keys_idempotent() {
        let input = serde_json::json!({"b": 2, "a": 1});
        let s1 = sort_json_keys(&input);
        let s2 = sort_json_keys(&s1);
        assert_eq!(s1, s2);
    }

    #[test]
    fn sort_json_keys_deterministic_across_runs() {
        let input = serde_json::json!({"beta": [3,1,2], "alpha": {"z": true, "a": false}});
        let a = sort_json_keys(&input);
        let b = sort_json_keys(&input);
        assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&b).unwrap());
    }

    #[test]
    fn sort_json_keys_preserves_arrays_and_primitives() {
        let input = serde_json::json!([1, "hello", null, true, 3.14]);
        let sorted = sort_json_keys(&input);
        assert_eq!(sorted, input);
    }
}
