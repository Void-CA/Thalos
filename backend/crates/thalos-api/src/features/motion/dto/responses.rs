use serde::Serialize;

/// Response returned by the motion endpoints.
///
/// When the runtime fully supports trajectory execution (#23), this will
/// carry the planned trajectory metadata and execution status. For now it
/// echoes the target joints and a confirmation that the command was
/// accepted.
#[derive(Debug, Serialize)]
pub struct MotionResponse {
    /// Status of the motion request.
    pub status: String,
    /// Target joint angles that were commanded.
    pub target_joints: Vec<f64>,
    /// Message with additional context (e.g. "using default velocity").
    pub message: String,
}
