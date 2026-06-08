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
use thalos_runtime::{SingularityService as RuntimeSingularityService, WorkspaceService as RuntimeWorkspaceService};

use thalos_core::analysis::singularity::SingularityConfig;

use crate::app::prelude::*;
use crate::app::state::AppState;
use crate::features::workspace::dto::{
    ReachabilityDto, ReachabilityRequest, SampleRequest,
    SingularityRequest, SingularityResponse, SingularitySampleDto,
    WorkspaceDto, WorkspaceSampleDto,
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
