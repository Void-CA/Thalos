use serde::{Deserialize, Serialize};

use thalos_core::execution::runtime::RuntimeProgram;
use thalos_planning::motion::program::CompiledPlan;

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

/// Response returned by `POST /motion/plan`.
///
/// Carries the same IR-3 artifacts the semantic path produces: the compiled
/// trajectory plan and the absolute-timed runtime event program. The
/// endpoint is plan-only (preview semantics) — nothing is scheduled into
/// the scene runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionPlanResponse {
    /// Compiled trajectory plan (IR-3).
    pub compiled_plan: CompiledPlan,
    /// Temporal runtime events (IR-3, absolute `at_time`).
    pub runtime_program: RuntimeProgram,
}
