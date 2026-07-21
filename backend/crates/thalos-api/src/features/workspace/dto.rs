//! DTOs (Data Transfer Objects) for workspace analysis endpoints.
//!
//! All DTOs derive `Serialize` / `Deserialize` for JSON transport via axum.
//! Domain types from `thalos_core` are converted explicitly; serde is NOT
//! added to the core crate (boundary enforcement).

use serde::{Deserialize, Serialize};

use thalos_core::analysis::manipulability::ManipulabilityMetrics;
use thalos_core::analysis::singularity::{
    SingularityMetrics, SingularityState,
};
use thalos_core::analysis::workspace::{
    BoundingBox, Reachability, WorkspaceMetrics, WorkspaceSample,
};
use thalos_math::Vector3;

// ─── Requests ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SampleRequest {
    pub robot_id: String,
    #[serde(default = "default_samples")]
    pub samples: usize,
    #[serde(default)]
    pub seed: u64,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default)]
    pub include_samples: bool,
}

fn default_samples() -> usize { 10_000 }
fn default_tolerance() -> f64 { 1e-3 }

#[derive(Debug, Deserialize)]
pub struct ReachabilityRequest {
    pub point: PointDto,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PointDto {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl From<PointDto> for Vector3 {
    fn from(p: PointDto) -> Self {
        Vector3::new(p.x, p.y, p.z)
    }
}

// ─── Responses ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct WorkspaceDto {
    pub metrics: WorkspaceMetricsDto,
    pub bounds: BoundingBoxDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<WorkspaceSampleDto>>,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceMetricsDto {
    pub bounding_volume: f64,
    pub max_reach: f64,
    pub min_reach: f64,
    pub centroid: PointDto,
    pub sample_count: usize,
}

impl From<WorkspaceMetrics> for WorkspaceMetricsDto {
    fn from(m: WorkspaceMetrics) -> Self {
        Self {
            bounding_volume: m.bounding_volume,
            max_reach: m.max_reach,
            min_reach: m.min_reach,
            centroid: PointDto {
                x: m.centroid.x,
                y: m.centroid.y,
                z: m.centroid.z,
            },
            sample_count: m.sample_count,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct BoundingBoxDto {
    pub min: PointDto,
    pub max: PointDto,
}

// ─── Singularity DTOs ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SingularityRequest {
    pub robot_id: String,
    #[serde(default = "default_samples")]
    pub samples: usize,
    #[serde(default)]
    pub seed: u64,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_near_singular_threshold")]
    pub near_singular_condition_threshold: f64,
    #[serde(default)]
    pub include_samples: bool,
}

fn default_near_singular_threshold() -> f64 { 100.0 }

#[derive(Debug, Serialize)]
pub struct SingularityResponse {
    pub metrics: SingularityMetricsDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<SingularitySampleDto>>,
}

#[derive(Debug, Serialize)]
pub struct SingularityMetricsDto {
    pub total_samples: usize,
    pub singular_count: usize,
    pub near_singular_count: usize,
    pub normal_count: usize,
    pub avg_condition_number: f64,
    pub min_condition_number: f64,
    pub max_condition_number: f64,
    pub avg_sigma_min: f64,
}

impl From<SingularityMetrics> for SingularityMetricsDto {
    fn from(m: SingularityMetrics) -> Self {
        Self {
            total_samples: m.total_samples,
            singular_count: m.singular_count,
            near_singular_count: m.near_singular_count,
            normal_count: m.normal_count,
            avg_condition_number: m.avg_condition_number,
            min_condition_number: m.min_condition_number,
            max_condition_number: m.max_condition_number,
            avg_sigma_min: m.avg_sigma_min,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SingularitySampleDto {
    pub position: PointDto,
    pub state: String,
}

impl From<&thalos_core::analysis::singularity::SingularitySample> for SingularitySampleDto {
    fn from(s: &thalos_core::analysis::singularity::SingularitySample) -> Self {
        Self {
            position: PointDto {
                x: s.position.x,
                y: s.position.y,
                z: s.position.z,
            },
            state: match s.state {
                SingularityState::Normal => "normal".into(),
                SingularityState::NearSingular => "near_singular".into(),
                SingularityState::Singular => "singular".into(),
            },
        }
    }
}

// ─── Manipulability DTOs ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ManipulabilityRequest {
    pub robot_id: String,
    #[serde(default = "default_samples")]
    pub samples: usize,
    #[serde(default)]
    pub seed: u64,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default)]
    pub include_samples: bool,
}

#[derive(Debug, Serialize)]
pub struct ManipulabilityResponse {
    pub metrics: ManipulabilityMetricsDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<ManipulabilitySampleDto>>,
}

#[derive(Debug, Serialize)]
pub struct ManipulabilityMetricsDto {
    pub total_samples: usize,
    pub avg_yoshikawa: f64,
    pub min_yoshikawa: f64,
    pub max_yoshikawa: f64,
    pub avg_isotropy: f64,
    pub min_isotropy: f64,
    pub max_isotropy: f64,
}

impl From<ManipulabilityMetrics> for ManipulabilityMetricsDto {
    fn from(m: ManipulabilityMetrics) -> Self {
        Self {
            total_samples: m.total_samples,
            avg_yoshikawa: m.avg_yoshikawa,
            min_yoshikawa: m.min_yoshikawa,
            max_yoshikawa: m.max_yoshikawa,
            avg_isotropy: m.avg_isotropy,
            min_isotropy: m.min_isotropy,
            max_isotropy: m.max_isotropy,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ManipulabilitySampleDto {
    pub position: PointDto,
    pub yoshikawa: f64,
    pub isotropy: f64,
}

impl From<&thalos_core::analysis::manipulability::ManipulabilitySample> for ManipulabilitySampleDto {
    fn from(s: &thalos_core::analysis::manipulability::ManipulabilitySample) -> Self {
        Self {
            position: PointDto {
                x: s.position.x,
                y: s.position.y,
                z: s.position.z,
            },
            yoshikawa: s.manipulability.yoshikawa,
            isotropy: s.manipulability.isotropy,
        }
    }
}

impl From<BoundingBox> for BoundingBoxDto {
    fn from(bb: BoundingBox) -> Self {
        Self {
            min: PointDto { x: bb.min.x, y: bb.min.y, z: bb.min.z },
            max: PointDto { x: bb.max.x, y: bb.max.y, z: bb.max.z },
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WorkspaceSampleDto {
    pub q: Vec<f64>,
    pub position: PointDto,
}

impl From<&WorkspaceSample> for WorkspaceSampleDto {
    fn from(s: &WorkspaceSample) -> Self {
        Self {
            q: s.q.clone(),
            position: PointDto {
                x: s.position.x,
                y: s.position.y,
                z: s.position.z,
            },
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ReachabilityDto {
    pub reachable: bool,
    pub nearest_distance: f64,
}

impl From<Reachability> for ReachabilityDto {
    fn from(r: Reachability) -> Self {
        match r {
            Reachability::Reachable => Self {
                reachable: true,
                nearest_distance: 0.0,
            },
            Reachability::OutOfWorkspace { nearest_distance } => Self {
                reachable: false,
                nearest_distance,
            },
        }
    }
}

// ─── Active-robot endpoints ─────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ActiveSampleRequest {
    #[serde(default = "default_samples")]
    pub samples: usize,
    #[serde(default)]
    pub seed: u64,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default)]
    pub include_samples: bool,
}

#[derive(Debug, Deserialize)]
pub struct ActiveSingularityRequest {
    #[serde(default = "default_samples")]
    pub samples: usize,
    #[serde(default)]
    pub seed: u64,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_near_singular_threshold")]
    pub near_singular_condition_threshold: f64,
    #[serde(default)]
    pub include_samples: bool,
}

#[derive(Debug, Deserialize)]
pub struct ActiveAnalysisRequest {
    #[serde(default = "default_samples")]
    pub samples: usize,
    #[serde(default)]
    pub seed: u64,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_near_singular_threshold")]
    pub near_singular_condition_threshold: f64,
    #[serde(default)]
    pub include_samples: bool,
}

#[derive(Debug, Serialize)]
pub struct ActiveAnalysisResponse {
    pub workspace: WorkspaceMetricsDto,
    pub bounds: BoundingBoxDto,
    pub singularity: SingularityMetricsDto,
    pub manipulability: ManipulabilityMetricsDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub singularity_samples: Option<Vec<SingularitySampleDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manipulability_samples: Option<Vec<ManipulabilitySampleDto>>,
}
