//! DTOs (Data Transfer Objects) for workspace analysis endpoints.
//!
//! All DTOs derive `Serialize` / `Deserialize` for JSON transport via axum.
//! Domain types from `thalos_core` are converted explicitly; serde is NOT
//! added to the core crate (boundary enforcement).

use serde::{Deserialize, Serialize};

use thalos_core::analysis::manipulability::ManipulabilityMetrics;
use thalos_core::analysis::singularity::{SingularityMetrics, SingularityState};
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

fn default_samples() -> usize {
    10_000
}
fn default_tolerance() -> f64 {
    1e-3
}

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

fn default_near_singular_threshold() -> f64 {
    100.0
}

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

#[derive(Debug, Serialize, Deserialize)]
pub struct ManipulabilityResponse {
    pub metrics: ManipulabilityMetricsDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<ManipulabilitySampleDto>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ManipulabilityMetricsDto {
    pub total_samples: usize,
    pub avg_yoshikawa: f64,
    pub min_yoshikawa: f64,
    pub max_yoshikawa: f64,
    pub avg_isotropy: f64,
    pub min_isotropy: f64,
    pub max_isotropy: f64,
    /// Chain-side canonical robot-scale normalization factor (`L_ref`,
    /// meters). ADITIVO (`#[serde(default)]` → 0.0): payloads legacy sin el
    /// campo deserializan sin error (spec analysis-report-contract "Additive
    /// Reference Dimension on Metrics").
    #[serde(default)]
    pub reference_dimension: f64,
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
            reference_dimension: m.reference_dimension,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ManipulabilitySampleDto {
    pub position: PointDto,
    pub yoshikawa: f64,
    pub isotropy: f64,
    /// Medida dimensionless `∏σ′ᵢ` (spec analysis-report-contract "Additive
    /// Normalized Manipulability on Wire"). ADITIVO (`#[serde(default)]` →
    /// 0.0): payloads legacy sin el campo deserializan sin error.
    #[serde(default)]
    pub normalized_yoshikawa: f64,
    /// Grade clasificado por el backend (`"low" | "medium" | "high"`).
    /// `None` = payload legacy → fallback frontend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manipulability_grade: Option<String>,
}

impl From<&thalos_core::analysis::manipulability::ManipulabilitySample>
    for ManipulabilitySampleDto
{
    fn from(s: &thalos_core::analysis::manipulability::ManipulabilitySample) -> Self {
        Self {
            position: PointDto {
                x: s.position.x,
                y: s.position.y,
                z: s.position.z,
            },
            yoshikawa: s.manipulability.yoshikawa,
            isotropy: s.manipulability.isotropy,
            normalized_yoshikawa: s.manipulability.normalized_yoshikawa,
            manipulability_grade: s
                .manipulability
                .manipulability_grade
                .map(|g| g.as_str().to_string()),
        }
    }
}

impl From<BoundingBox> for BoundingBoxDto {
    fn from(bb: BoundingBox) -> Self {
        Self {
            min: PointDto {
                x: bb.min.x,
                y: bb.min.y,
                z: bb.min.z,
            },
            max: PointDto {
                x: bb.max.x,
                y: bb.max.y,
                z: bb.max.z,
            },
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

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::analysis::manipulability::{ManipulabilityMetrics, ManipulabilitySample};
    use thalos_core::kinematics::jacobian::manipulability::ManipulabilityGrade;
    use thalos_core::kinematics::jacobian::ManipulabilityReport;
    use thalos_core::kinematics::jacobian::SingularityReport;

    // ─── Task 3.3: additive normalized + grade + reference_dimension ────────
    //
    // Spec analysis-report-contract: ManipulabilitySampleDto carries
    // normalized_yoshikawa + manipulability_grade (additive); metrics expose
    // reference_dimension (additive).

    fn sample_with_normalization(normalized: f64, grade: ManipulabilityGrade) -> ManipulabilitySample {
        ManipulabilitySample {
            q: vec![0.1, 0.2],
            position: Vector3::new(0.3, 0.4, 0.5),
            singularity: SingularityReport {
                det_jtj: 0.01,
                condition_number: 2.0,
                rank: 2,
                singular_values: vec![0.5, 0.2],
            },
            manipulability: ManipulabilityReport {
                yoshikawa: 0.1,
                isotropy: 0.4,
                normalized_yoshikawa: normalized,
                manipulability_grade: Some(grade),
            },
        }
    }

    #[test]
    fn manipulability_sample_projects_normalized_and_grade() {
        let sample = sample_with_normalization(0.22, ManipulabilityGrade::Medium);
        let dto = ManipulabilitySampleDto::from(&sample);
        let value = serde_json::to_value(&dto).expect("serialize");

        assert!(
            (value["normalized_yoshikawa"].as_f64().expect("f64") - 0.22).abs() < 1e-12,
            "normalized_yoshikawa must project"
        );
        assert_eq!(
            value["manipulability_grade"], "medium",
            "grade must project lowercase"
        );
        assert!((value["yoshikawa"].as_f64().expect("f64") - 0.1).abs() < 1e-12);
        assert!((value["isotropy"].as_f64().expect("f64") - 0.4).abs() < 1e-12);
        assert_eq!(value["position"]["x"], 0.3);
    }

    #[test]
    fn metrics_dto_exposes_reference_dimension() {
        let metrics = ManipulabilityMetrics {
            total_samples: 10,
            avg_yoshikawa: 0.5,
            min_yoshikawa: 0.1,
            max_yoshikawa: 0.9,
            avg_isotropy: 0.4,
            min_isotropy: 0.1,
            max_isotropy: 0.8,
            reference_dimension: 2.3,
        };
        let dto = ManipulabilityMetricsDto::from(metrics);
        let value = serde_json::to_value(&dto).expect("serialize");
        assert!(
            (value["reference_dimension"].as_f64().expect("f64") - 2.3).abs() < 1e-12,
            "reference_dimension must project (spec scenario: L_ref = 0.5 → 0.5)"
        );
    }

    #[test]
    fn legacy_manipulability_payload_round_trips_with_defaults() {
        // Spec "Legacy payload missing normalized fields" + "Legacy payload
        // without reference_dimension": fields absent on the wire deserialize
        // to 0.0 / None — never an error.
        let response = ManipulabilityResponse {
            metrics: ManipulabilityMetricsDto {
                total_samples: 1,
                avg_yoshikawa: 0.5,
                min_yoshikawa: 0.5,
                max_yoshikawa: 0.5,
                avg_isotropy: 0.4,
                min_isotropy: 0.4,
                max_isotropy: 0.4,
                reference_dimension: 2.3,
            },
            samples: Some(vec![ManipulabilitySampleDto {
                position: PointDto { x: 0.3, y: 0.4, z: 0.5 },
                yoshikawa: 0.5,
                isotropy: 0.4,
                normalized_yoshikawa: 0.22,
                manipulability_grade: Some("medium".to_string()),
            }]),
        };

        let mut value = serde_json::to_value(response).expect("serialize");
        value["samples"][0]
            .as_object_mut()
            .expect("sample")
            .remove("normalized_yoshikawa");
        value["samples"][0]
            .as_object_mut()
            .expect("sample")
            .remove("manipulability_grade");
        value["metrics"]
            .as_object_mut()
            .expect("metrics")
            .remove("reference_dimension");

        let back: ManipulabilityResponse =
            serde_json::from_value(value).expect("legacy payload must deserialize");
        assert_eq!(back.samples.as_ref().expect("samples")[0].normalized_yoshikawa, 0.0);
        assert_eq!(back.samples.as_ref().expect("samples")[0].manipulability_grade, None);
        assert_eq!(back.metrics.reference_dimension, 0.0);
        assert!(
            (back.samples.as_ref().expect("samples")[0].yoshikawa - 0.5).abs() < 1e-12,
            "pre-existing fields keep their values"
        );
    }
}
