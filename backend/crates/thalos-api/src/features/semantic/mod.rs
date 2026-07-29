pub mod handler;

use serde::{Deserialize, Serialize};

/// A single semantic operation from a JSON request.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SemanticOpDto {
    Pick {
        object: String,
        #[serde(default)]
        tool: Option<String>,
    },
    Place {
        object: String,
        destination: String,
        #[serde(default)]
        tool: Option<String>,
    },
    MoveTo {
        destination: String,
        #[serde(default)]
        tool: Option<String>,
    },
    Wait {
        duration_secs: f64,
    },
    Home,
}

/// A pose definition for a resource.
#[derive(Debug, Clone, Deserialize)]
pub struct PoseDto {
    pub position: [f64; 3],
    pub orientation: [f64; 4],
}

/// A semantic resource definition.
#[derive(Debug, Clone, Deserialize)]
pub struct ResourcePoseDto {
    pub id: String,
    pub pose: PoseDto,
}

/// Request body for compiling a semantic task.
#[derive(Debug, Clone, Deserialize)]
pub struct CompileRequest {
    pub operations: Vec<SemanticOpDto>,
    /// Optional resource definitions. If omitted, all resources resolve to origin.
    #[serde(default)]
    pub objects: Vec<ResourcePoseDto>,
    #[serde(default)]
    pub locations: Vec<ResourcePoseDto>,
    /// Optional home pose. If omitted, uses origin.
    pub home_pose: Option<PoseDto>,
}

/// Summary of the generated execution plan.
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionPlanSummary {
    pub segment_count: usize,
    pub duration_ms: u64,
}

/// Validation diagnostics from the pipeline.
#[derive(Debug, Clone, Serialize)]
pub struct ValidationSummary {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Processing metadata.
#[derive(Debug, Clone, Serialize)]
pub struct CompileMetadata {
    pub instruction_count: usize,
    pub planning_time_ms: u64,
}

/// Successful response from compiling a semantic task.
#[derive(Debug, Clone, Serialize)]
pub struct CompileResponse {
    pub status: String,
    pub execution_plan: ExecutionPlanSummary,
    pub validation: ValidationSummary,
    pub metadata: CompileMetadata,
}
