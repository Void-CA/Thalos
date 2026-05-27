use chrono::{DateTime, Utc};
use serde::Serialize;
use thalos_visual::VisualScene;

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
    pub error: Option<String>,
}
