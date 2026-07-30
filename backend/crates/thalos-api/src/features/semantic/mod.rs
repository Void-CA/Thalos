pub mod handler;

use serde::{Deserialize, Serialize};

use thalos_document::task_document::TaskDocument;

/// Request body wrapping a `TaskDocument` for semantic compilation.
#[derive(Debug, Clone, Deserialize)]
pub struct SemanticCompileRequest {
    pub task: TaskDocument,
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
///
/// Contains the `motion_program` that can be sent to `POST /planning/plan`
/// for trajectory generation and viewport playback.
#[derive(Debug, Clone, Serialize)]
pub struct CompileResponse {
    pub status: String,
    pub validation: ValidationSummary,
    pub metadata: CompileMetadata,
    /// The generated `MotionProgram` — feed to `/planning/plan`.
    pub motion_program: thalos_core::motion::MotionProgram,
}
