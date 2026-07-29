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

/// Request body for compiling a semantic task.
#[derive(Debug, Clone, Deserialize)]
pub struct CompileRequest {
    pub operations: Vec<SemanticOpDto>,
}

/// Response from compiling a semantic task.
#[derive(Debug, Clone, Serialize)]
pub struct CompileResponse {
    pub status: String,
    pub segment_count: usize,
    pub duration_ms: u64,
    pub warnings: Vec<String>,
}
