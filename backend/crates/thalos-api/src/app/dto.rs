use serde::Deserialize;
use thalos_visual::VisualScene;

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

#[derive(serde::Serialize)]
pub struct ValidateResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ErrorResponse {
    pub error: String,
}
