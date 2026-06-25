//! Axum handlers for workspace endpoints.
//!
//! Each handler is self-contained — no coupling between endpoints.
//! The `reachability` handler re-samples a workspace internally so
//! it can be called independently of `sample`.

use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};

use thalos_core::analysis::workspace::WorkspaceConfig;
use thalos_core::math::geometry::vectors::Vector3;
use thalos_core::models::RobotModel;
use thalos_runtime::{ManipulabilityService as RuntimeManipulabilityService, SingularityService as RuntimeSingularityService, WorkspaceService as RuntimeWorkspaceService};

use thalos_core::analysis::singularity::SingularityConfig;

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::workspace::dto::{
    ActiveAnalysisRequest, ActiveAnalysisResponse, ActiveSampleRequest,
    ManipulabilityRequest, ManipulabilityResponse, ManipulabilitySampleDto,
    ReachabilityDto, ReachabilityRequest, SampleRequest,
    SingularityRequest, SingularityResponse, SingularitySampleDto,
    WorkspaceDto, WorkspaceSampleDto, BoundingBoxDto,
};

/// POST /api/v1/workspace/sample
pub async fn sample(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<SampleRequest>,
) -> ApiResult<WorkspaceDto> {
    let model = RobotModel::from_id(&req.robot_id)
        .map_err(|_| ApiError::NotFound {
            message: format!("Robot '{}' not found", req.robot_id),
        })?;

    let config = WorkspaceConfig {
        samples: req.samples,
        seed: req.seed,
        tolerance: req.tolerance,
    };

    let ws = RuntimeWorkspaceService::sample(model, config)?;

    let samples = if req.include_samples {
        Some(ws.samples().iter().map(WorkspaceSampleDto::from).collect())
    } else {
        None
    };

    Ok(Json(WorkspaceDto {
        metrics: ws.metrics().clone().into(),
        bounds: ws.bounds().clone().into(),
        samples,
    }))
}

/// POST /api/v1/workspace/reachability
///
/// Self-contained: samples a Scara workspace with default params,
/// then runs the reachability query. Future versions may accept
/// workspace parameters in the request body.
pub async fn reachability(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<ReachabilityRequest>,
) -> ApiResult<ReachabilityDto> {
    let config = WorkspaceConfig {
        samples: 10_000,
        seed: 0,
        tolerance: req.tolerance,
    };
    let ws = RuntimeWorkspaceService::sample(RobotModel::Scara, config)?;

    let point: Vector3 = req.point.into();
    let result = RuntimeWorkspaceService::query(&ws, &point, req.tolerance)?;
    Ok(Json(result.into()))
}

/// POST /api/v1/workspace/singularity
pub async fn singularity(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<SingularityRequest>,
) -> ApiResult<SingularityResponse> {
    let model = RobotModel::from_id(&req.robot_id)
        .map_err(|_| ApiError::NotFound {
            message: format!("Robot '{}' not found", req.robot_id),
        })?;

    let config = thalos_core::analysis::workspace::WorkspaceConfig {
        samples: req.samples,
        seed: req.seed,
        tolerance: req.tolerance,
    };

    let singularity_config = SingularityConfig {
        near_singular_condition_threshold: req.near_singular_condition_threshold,
    };

    let analysis = RuntimeSingularityService::analyze(model, config, singularity_config)?;

    let samples = if req.include_samples {
        Some(analysis.samples.iter().map(SingularitySampleDto::from).collect())
    } else {
        None
    };

    Ok(Json(SingularityResponse {
        metrics: analysis.metrics.into(),
        samples,
    }))
}

/// POST /api/v1/workspace/manipulability
pub async fn manipulability(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<ManipulabilityRequest>,
) -> ApiResult<ManipulabilityResponse> {
    let model = RobotModel::from_id(&req.robot_id)
        .map_err(|_| ApiError::NotFound {
            message: format!("Robot '{}' not found", req.robot_id),
        })?;

    let config = thalos_core::analysis::workspace::WorkspaceConfig {
        samples: req.samples,
        seed: req.seed,
        tolerance: req.tolerance,
    };

    let analysis = RuntimeManipulabilityService::analyze(model, config)?;

    let samples = if req.include_samples {
        Some(analysis.samples.iter().map(ManipulabilitySampleDto::from).collect())
    } else {
        None
    };

    Ok(Json(ManipulabilityResponse {
        metrics: analysis.metrics.into(),
        samples,
    }))
}

// ─── Active-robot endpoints ─────────────────────────────────────

/// POST /api/v1/workspace/sample/active
///
/// Workspace analysis on the currently loaded robot (URDF or canonical).
pub async fn sample_active(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActiveSampleRequest>,
) -> ApiResult<WorkspaceDto> {
    let snapshot = state.services.scene.snapshot()?;

    let config = WorkspaceConfig {
        samples: req.samples,
        seed: req.seed,
        tolerance: req.tolerance,
    };

    let ws = RuntimeWorkspaceService::sample_from_chain(&snapshot.chain, config)?;

    let samples = if req.include_samples {
        Some(ws.samples().iter().map(WorkspaceSampleDto::from).collect())
    } else {
        None
    };

    Ok(Json(WorkspaceDto {
        metrics: ws.metrics().clone().into(),
        bounds: ws.bounds().clone().into(),
        samples,
    }))
}

/// POST /api/v1/workspace/bounds/active
///
/// Lightweight endpoint: returns only the bounding box of the workspace
/// for the currently loaded robot.
pub async fn bounds_active(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActiveSampleRequest>,
) -> ApiResult<BoundingBoxDto> {
    let snapshot = state.services.scene.snapshot()?;

    let config = WorkspaceConfig {
        samples: req.samples,
        seed: req.seed,
        tolerance: req.tolerance,
    };

    let ws = RuntimeWorkspaceService::sample_from_chain(&snapshot.chain, config)?;

    Ok(Json(ws.bounds().clone().into()))
}

/// POST /api/v1/workspace/analyze/active
///
/// Full analysis (workspace + singularity + manipulability) on the
/// currently loaded robot, all from a single set of samples.
pub async fn analyze_active(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActiveAnalysisRequest>,
) -> ApiResult<ActiveAnalysisResponse> {
    let snapshot = state.services.scene.snapshot()?;

    let config = WorkspaceConfig {
        samples: req.samples,
        seed: req.seed,
        tolerance: req.tolerance,
    };

    let singularity_config = SingularityConfig {
        near_singular_condition_threshold: req.near_singular_condition_threshold,
    };

    // All three analyses share the same chain and config — sample once.
    let ws = RuntimeWorkspaceService::sample_from_chain(&snapshot.chain, config)?;
    let singularity = RuntimeSingularityService::analyze_from_chain(
        &snapshot.chain,
        config,
        singularity_config,
    )?;
    let manipulability =
        RuntimeManipulabilityService::analyze_from_chain(&snapshot.chain, config)?;

    let singularity_samples = if req.include_samples {
        Some(singularity.samples.iter().map(SingularitySampleDto::from).collect())
    } else {
        None
    };

    let manipulability_samples = if req.include_samples {
        Some(manipulability.samples.iter().map(ManipulabilitySampleDto::from).collect())
    } else {
        None
    };

    Ok(Json(ActiveAnalysisResponse {
        workspace: ws.metrics().clone().into(),
        bounds: ws.bounds().clone().into(),
        singularity: singularity.metrics.into(),
        manipulability: manipulability.metrics.into(),
        singularity_samples,
        manipulability_samples,
    }))
}
