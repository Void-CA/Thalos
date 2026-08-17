//! Demo handlers (design D3/D9/D10/D12).
//! Resolution (D10): `catalog.lookup(id)` → entry → known filename → read →
//! parse + validate → response. NEVER `filesystem/{id}/scene.json`; the
//! client sends a `demo_id` only.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use thalos_document::scene_file::SceneFile;
use thalos_document::scene_file_validation::validate_scene_file;

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::demos::catalog::{CatalogError, DemoCatalog, DemoCatalogEntry};

/// `GET /demos` — catalog listing (metadata only; scene/program fetched
/// separately per spec). Empty catalog → `[]` (design).
pub async fn list_demos() -> ApiResult<Vec<DemoCatalogEntry>> {
    let catalog = DemoCatalog::load().map_err(catalog_error)?;
    Ok(Json(catalog.entries().to_vec()))
}

/// `GET /demos/{id}/scene` — SceneFile JSON for the demo, resolved via the
/// catalog (D10). Tier (a)+(b) validation failures are server errors (422 with
/// details); a missing demo is 404 `DEMO_NOT_FOUND`.
pub async fn get_demo_scene(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<SceneFile> {
    let catalog = DemoCatalog::load().map_err(catalog_error)?;
    let entry = lookup(&catalog, &id)?;

    let text =
        std::fs::read_to_string(catalog.scene_path(entry)).map_err(|e| ApiError::Internal {
            message: format!("failed to read scene file for demo '{}': {e}", entry.id),
        })?;
    let file: SceneFile = serde_json::from_str(&text).map_err(|e| ApiError::Validation {
        message: format!("demo '{}' scene failed schema parsing: {e}", entry.id),
        code: "DEMO_SCENE_INVALID".into(),
    })?;
    validate_scene_file(&file).map_err(|errors| ApiError::Validation {
        message: format!("demo '{}' scene failed validation: {errors:?}", entry.id),
        code: "DEMO_SCENE_INVALID".into(),
    })?;

    // Tier (c): robot compat vs the runtime robot (D3). NON-BLOCKING warning
    // (spec tier (c): "warning or error"; D13 Load ≠ Run — the web fetches the
    // scene FIRST, loads the robot from its urdf ref later, so a fetch-time
    // mismatch is expected and must not block serving the file).
    if let Ok(snapshot) = state.services.scene.snapshot().await {
        if let Err(mismatch) = thalos_document::scene_file_validation::validate_robot_compat(
            &file,
            &snapshot.robot_name,
        ) {
            tracing::warn!(
                demo = %entry.id,
                expected = %mismatch.expected,
                loaded = %mismatch.loaded,
                "demo robot differs from the loaded runtime robot (tier c, non-blocking)"
            );
        }
    }

    Ok(Json(file))
}

/// `GET /demos/{id}/program` — program.thalos text (D8), `text/plain`.
pub async fn get_demo_program(Path(id): Path<String>) -> Result<(StatusCode, String), ApiError> {
    let catalog = DemoCatalog::load().map_err(catalog_error)?;
    let entry = lookup(&catalog, &id)?;

    let text =
        std::fs::read_to_string(catalog.program_path(entry)).map_err(|e| ApiError::Internal {
            message: format!("failed to read program file for demo '{}': {e}", entry.id),
        })?;
    Ok((StatusCode::OK, text))
}

/// Look up a demo through the catalog ONLY (D10); 404 with `DEMO_NOT_FOUND`.
fn lookup<'a>(catalog: &'a DemoCatalog, id: &str) -> Result<&'a DemoCatalogEntry, ApiError> {
    catalog
        .lookup(id)
        .ok_or_else(|| ApiError::NotFoundWithCode {
            message: format!("demo not found: '{}'", id),
            code: "DEMO_NOT_FOUND".into(),
        })
}

fn catalog_error(err: CatalogError) -> ApiError {
    ApiError::Internal {
        message: format!("failed to load demo catalog: {err:?}"),
    }
}
