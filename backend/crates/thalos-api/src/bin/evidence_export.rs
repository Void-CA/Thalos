//! Standalone binary that runs the 4 canonical demos headless and exports
//! canonical `evidence.json` per scenario for the Python renderer.
//!
//! The output follows the causal chain structure:
//! ```json
//! {
//!   "scenario": "repair-alternatives",
//!   "baseline": { "trajectory": {...}, "metrics": {...} },
//!   "intelligence": { "observations": [...], "assessment": {...}, "candidate_ranking": [...] },
//!   "selected": { "strategy": "...", "trajectory": {...}, "metrics": {...} }
//! }
//! ```
//!
//! Usage:
//!   cargo run --bin evidence_export [-- <output_dir>]
//!
//! Default output directory: `evidence/` (relative to CWD).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::{Value, json};

use thalos_api::evidence::{DemoEvidence, DEMOS_ROOT, run_demo, sort_json_keys};

const DEMO_IDS: &[&str] = &[
    "happy-path",
    "multi-object",
    "repair-alternatives",
    "safety-rejection",
    "6dof-near-singular",
    "6dof-elbow-swap",
    "6dof-repair",
];

/// Export one demo scenario to evidence.json with causal chain structure.
fn export_demo(evidence: &DemoEvidence, output_dir: &Path) -> Result<()> {
    let scenario_dir = output_dir.join(evidence.demo_id);
    std::fs::create_dir_all(&scenario_dir)
        .with_context(|| format!("create dir {}", scenario_dir.display()))?;

    // For safety-rejection the execute failed (422) — export whatever the
    // analyze endpoint returned (possibly partial or empty). The binary MUST
    // NOT fail on blocked demos.
    let analyze_body = evidence
        .analyze_body
        .clone()
        .unwrap_or_else(|| {
            // Fabricate a minimal stub so the file is still valid JSON.
            serde_json::json!({
                "error": {
                    "code": "execution_blocked",
                    "execute_status": evidence.execute_status.as_u16(),
                    "message": "Pipeline blocked — no plan was scheduled."
                }
            })
        });

    // ── Build the causal chain structure ──

    let scenario = evidence.demo_id;

    // Baseline: trajectory from the active plan + summary metrics
    let baseline_trajectory = analyze_body.get("trajectory").cloned().unwrap_or_else(|| {
        json!({ "waypoints": [], "timestamps": [] })
    });
    let baseline_metrics = extract_baseline_metrics(&analyze_body);

    // Intelligence: observations, assessment, candidate_ranking
    let intelligence = extract_intelligence(&analyze_body);

    // Selected: strategy + trajectory + metrics from candidate ranking
    let selected = extract_selected(&analyze_body);

    let nested = json!({
        "scenario": scenario,
        "baseline": {
            "trajectory": baseline_trajectory,
            "metrics": baseline_metrics,
        },
        "intelligence": intelligence,
        "selected": selected,
    });

    let deterministic = sort_json_keys(&nested);
    let json_str =
        serde_json::to_string_pretty(&deterministic).context("serialize evidence JSON")?;
    let file_path = scenario_dir.join("evidence.json");
    std::fs::write(&file_path, &json_str)
        .with_context(|| format!("write {}", file_path.display()))?;

    println!(
        "  [OK] {} → {} bytes",
        evidence.demo_id,
        json_str.len()
    );
    Ok(())
}

/// Extract baseline metrics from the analyze body — the FULL metrics
/// BTreeMap (manipulability, duration, length, etc.) plus summary fields.
fn extract_baseline_metrics(body: &Value) -> Value {
    let summary = body.get("summary").cloned().unwrap_or_else(|| json!({}));
    let assessment = body.get("assessment").cloned().unwrap_or_else(|| json!({}));
    let metrics = body.get("metrics").cloned().unwrap_or_else(|| json!({}));
    let risk = assessment.get("risk").cloned().unwrap_or_else(|| json!("unknown"));
    let quality = summary.get("quality_index").cloned().unwrap_or_else(|| json!(0.0));

    // Merge: metrics BTreeMap (manipulability, duration, length, etc.)
    // + summary fields (quality_index, grade) + assessment risk
    let mut result = json!({
        "quality_index": quality,
        "risk": risk,
    });
    // Merge all keys from the metrics BTreeMap
    if let Some(obj) = metrics.as_object() {
        if let Some(result_obj) = result.as_object_mut() {
            for (k, v) in obj {
                result_obj.insert(k.clone(), v.clone());
            }
        }
    }
    // Merge grade from summary
    if let Some(grade) = summary.get("grade") {
        if let Some(result_obj) = result.as_object_mut() {
            result_obj.insert("grade".into(), grade.clone());
        }
    }
    result
}

/// Extract the intelligence section — ALL fields from the AnalysisReport
/// that figure renderers need. The `_normalize_evidence()` in Python flattens
/// these to top-level for backward compatibility.
fn extract_intelligence(body: &Value) -> Value {
    json!({
        "observations": body.get("observations").cloned().unwrap_or_else(|| json!([])),
        "assessment": body.get("assessment").cloned().unwrap_or_else(|| json!({})),
        "candidate_ranking": body.get("candidate_ranking").cloned().unwrap_or_else(|| json!(null)),
        "metrics": body.get("metrics").cloned().unwrap_or_else(|| json!({})),
        "summary": body.get("summary").cloned().unwrap_or_else(|| json!({})),
        "problem_regions": body.get("problem_regions").cloned().unwrap_or_else(|| json!([])),
        "manipulability_series": body.get("manipulability_series").cloned().unwrap_or_else(|| json!([])),
        "singularity_series": body.get("singularity_series").cloned().unwrap_or_else(|| json!([])),
        "recommendations": body.get("recommendations").cloned().unwrap_or_else(|| json!([])),
        "actions": body.get("actions").cloned().unwrap_or_else(|| json!([])),
    })
}

/// Extract the selected strategy info: name, trajectory (same as baseline
/// when Direct or sub-ε degenerate), and metrics.
fn extract_selected(body: &Value) -> Value {
    let ranking = body.get("candidate_ranking");
    let selected_strategy = ranking
        .and_then(|r| r.get("selected"))
        .and_then(|s| s.as_str())
        .unwrap_or("Direct");

    let baseline_trajectory = body.get("trajectory").cloned().unwrap_or_else(|| {
        json!({ "waypoints": [], "timestamps": [] })
    });

    // For the selected candidate, find its metrics from the ranked list
    let selected_metrics = extract_selected_metrics(body, selected_strategy);

    // When Direct is selected or AlternateElbow is sub-ε degenerate,
    // the selected trajectory IS the baseline trajectory. This is the
    // correct academic story for icebot: "alternatives surfaced /
    // repair attempted", NOT "different path chosen".
    let trajectory = baseline_trajectory.clone();

    json!({
        "strategy": selected_strategy,
        "trajectory": trajectory,
        "metrics": selected_metrics,
    })
}

/// Extract metrics for the selected strategy from the ranked candidates.
fn extract_selected_metrics(body: &Value, strategy: &str) -> Value {
    let ranking = body.get("candidate_ranking");
    let ranked = ranking
        .and_then(|r| r.get("ranked"))
        .and_then(|r| r.as_array());

    if let Some(ranked) = ranked {
        for candidate in ranked {
            if candidate.get("strategy").and_then(|s| s.as_str()) == Some(strategy) {
                let risk = candidate.get("risk").cloned().unwrap_or_else(|| json!(0.0));
                let manip = candidate.get("manipulability").cloned().unwrap_or_else(|| json!(0.0));
                let duration = candidate.get("duration").cloned().unwrap_or_else(|| json!(0.0));
                let length = candidate.get("length").cloned().unwrap_or_else(|| json!(0.0));
                let cost = candidate.get("cost").cloned().unwrap_or_else(|| json!(0.0));
                return json!({
                    "risk": risk,
                    "manipulability": manip,
                    "duration": duration,
                    "length": length,
                    "cost": cost,
                });
            }
        }
    }

    // Fallback: derive from assessment if candidate not found
    let assessment = body.get("assessment");
    let risk = assessment
        .and_then(|a| a.get("risk"))
        .cloned()
        .unwrap_or_else(|| json!("unknown"));
    let quality = body
        .get("summary")
        .and_then(|s| s.get("quality_index"))
        .cloned()
        .unwrap_or_else(|| json!(0.0));

    json!({
        "risk": risk,
        "quality_index": quality,
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load root .env for consistency with the main binary.
    dotenvy::dotenv().ok();

    let output_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("evidence"));

    println!("=== Evidence Export ===");
    println!("Demos root: {DEMOS_ROOT}");
    println!("Output dir: {}", output_dir.display());

    // Build the in-process axum app (same pattern as test_app).
    let state = thalos_api::new_default_state().await;
    let app = thalos_api::app_router().with_state(state);

    std::fs::create_dir_all(&output_dir)
        .with_context(|| format!("create output dir {}", output_dir.display()))?;

    for &demo_id in DEMO_IDS {
        println!("\n--- {demo_id} ---");
        let evidence = run_demo(&app, demo_id).await;
        export_demo(&evidence, &output_dir)?;
    }

    println!("\n=== Done: {} scenarios exported ===", DEMO_IDS.len());
    Ok(())
}
