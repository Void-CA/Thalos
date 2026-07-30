pub mod handler;

use serde::{Deserialize, Serialize};

use thalos_document::task_document::TaskDocument;

/// Request body wrapping a `TaskDocument` for semantic compilation.
#[derive(Debug, Clone, Deserialize)]
pub struct SemanticCompileRequest {
    pub task: TaskDocument,
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
}

/// Successful response from compiling a semantic task.
///
/// Contains the `motion_program` — a `MotionProgram`.
#[derive(Debug, Clone, Serialize)]
pub struct CompileResponse {
    pub status: String,
    pub validation: ValidationSummary,
    pub metadata: CompileMetadata,
    pub motion_program: thalos_core::motion::MotionProgram,
}

/// Response from running a semantic task (compile + load into scene runtime).
#[derive(Debug, Clone, Serialize)]
pub struct RunResponse {
    pub status: String,
    pub segment_count: usize,
    pub duration_secs: f64,
}
