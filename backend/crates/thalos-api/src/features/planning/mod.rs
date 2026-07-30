pub mod handler;

use serde::Serialize;

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
