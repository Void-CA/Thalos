pub mod handler;

use serde::{Deserialize, Serialize};

/// A single waypoint in the trajectory — joint state at a given time.
#[derive(Debug, Clone, Serialize)]
pub struct WaypointDto {
    pub time_secs: f64,
    pub joints: Vec<f64>,
}

/// Response from planning a MotionProgram.
#[derive(Debug, Clone, Serialize)]
pub struct PlanResponse {
    pub status: String,
    pub waypoints: Vec<WaypointDto>,
    pub segment_count: usize,
    pub total_duration_secs: f64,
    pub robot_model: String,
}

/// A single frame transform computed by FK for a given joint state.
#[derive(Debug, Clone, Serialize)]
pub struct FrameTransformDto {
    pub id: String,
    pub translation: [f64; 3],
    pub rotation: [f64; 4],
}

/// Request for FK computation.
#[derive(Debug, Clone, Deserialize)]
pub struct FkRequest {
    pub joints: Vec<f64>,
}

/// Response from FK computation.
#[derive(Debug, Clone, Serialize)]
pub struct FkResponse {
    pub frames: Vec<FrameTransformDto>,
}
