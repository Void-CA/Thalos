use serde::{Deserialize, Serialize};
use thalos_runtime::plan::ExecutionMode;
use thalos_runtime::session::SessionData;

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionResponse {
    pub id: u64,
    pub plan_id: String,
    pub source: String,
    pub status: String,
    pub started_at: Option<String>,
    pub paused_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration: f64,
    pub joint_count: usize,
    pub robot_name: String,
    /// Execution mode — `"once"` or `{"repeat":{"count":N}}` (SM1).
    #[serde(default)]
    pub mode: ExecutionMode,
    /// Current iteration, 1-based (SM2).
    #[serde(default = "default_iteration")]
    pub iteration: u32,
    /// Total iterations; `None` for `Once` (SM3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_iterations: Option<u32>,
}

fn default_iteration() -> u32 {
    1
}

impl From<SessionData> for SessionResponse {
    fn from(s: SessionData) -> Self {
        Self {
            id: s.id,
            plan_id: s.plan_id,
            source: s.source.to_string(),
            status: format!("{:?}", s.status),
            started_at: s.started_at.map(|t| t.to_rfc3339()),
            paused_at: s.paused_at.map(|t| t.to_rfc3339()),
            completed_at: s.completed_at.map(|t| t.to_rfc3339()),
            duration: s.duration,
            joint_count: s.joint_count,
            robot_name: s.robot_name,
            mode: s.mode,
            iteration: s.iteration,
            total_iterations: s.total_iterations,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ReplayRequest {
    /// Session ID to replay.
    pub session_id: u64,
    /// Optional interpolation method.
    #[serde(default = "default_interpolation")]
    pub interpolation: String,
}

fn default_interpolation() -> String {
    "linear".to_string()
}

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    /// Raw JSON content of the trace file.
    pub trace_json: String,
    /// Optional robot name.
    #[serde(default = "default_robot_name")]
    pub robot_name: String,
}

fn default_robot_name() -> String {
    "imported".to_string()
}
