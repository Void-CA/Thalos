//! Standalone binary that runs the 4 canonical demos headless and exports
//! canonical `evidence.json` per scenario for the Python renderer.
//!
//! Usage:
//!   cargo run --bin evidence_export [-- <output_dir>]
//!
//! Default output directory: `evidence/` (relative to CWD).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use thalos_api::evidence::{DemoEvidence, DEMOS_ROOT, run_demo, sort_json_keys};

const DEMO_IDS: &[&str] = &[
    "happy-path",
    "multi-object",
    "repair-alternatives",
    "safety-rejection",
];

/// Export one demo scenario to evidence.json.
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

    let deterministic = sort_json_keys(&analyze_body);
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
