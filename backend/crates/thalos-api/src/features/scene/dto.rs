use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thalos_visual::VisualScene;

// ── Request DTOs ──

#[derive(Deserialize)]
pub struct FromFkRequest {
    pub joint_angles: Vec<f64>,
}

#[derive(Deserialize)]
pub struct ValidateRequest {
    pub scene: VisualScene,
}

#[derive(Deserialize)]
pub struct DiffRequest {
    pub old: VisualScene,
    pub new: VisualScene,
    #[serde(default = "default_epsilon")]
    pub epsilon: f64,
}

fn default_epsilon() -> f64 {
    1e-6
}

// ── Response DTOs ──

#[derive(Serialize)]
pub struct SceneResponse {
    pub scene: VisualScene,
    pub generated_at: DateTime<Utc>,
}

impl SceneResponse {
    pub fn new(scene: VisualScene) -> Self {
        Self {
            scene,
            generated_at: Utc::now(),
        }
    }
}

#[derive(Serialize)]
pub struct ValidateResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
