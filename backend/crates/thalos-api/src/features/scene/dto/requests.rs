use serde::Deserialize;

use super::responses::VisualSceneDto;

#[derive(Deserialize)]
pub struct SetJointsRequest {
    pub joint_angles: Vec<f64>,
}

#[derive(Deserialize)]
pub struct FromFkRequest {
    pub joint_angles: Vec<f64>,
}

#[derive(Deserialize)]
pub struct ValidateRequest {
    pub scene: VisualSceneDto,
}

#[derive(Deserialize)]
pub struct DiffRequest {
    pub old: VisualSceneDto,
    pub new: VisualSceneDto,
    #[serde(default = "default_epsilon")]
    pub epsilon: f64,
}

#[derive(Debug, Deserialize)]
pub struct LoadRobotRequest {
    pub robot_id: String,
}

fn default_epsilon() -> f64 {
    1e-6
}
