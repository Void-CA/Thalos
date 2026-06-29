use chrono::{DateTime, Utc};

use thalos_core::{
    kinematics::{
        forward::result::FKResult,
        inverse::result::IKResult,
    },
    models::RobotModel,
    robot::serial_chain::SerialChain,
};
use thalos_models::Robot;

use crate::plan::{ActiveMotionPlan, ExecutionSession};

/// Lightweight joint metadata for URDF-imported robots.
///
/// Mirrors core's `JointInfo` but uses owned strings so it can represent
/// dynamically-imported robots from URDF source.
#[derive(Debug, Clone)]
pub struct JointMeta {
    pub name: String,
    pub kind: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// Immutable snapshot of the runtime state at a point in time.
///
/// Contains only domain state — no visual representation.
/// Visual scene construction is the responsibility of the API layer.
/// When produced by an IK command, `ik_result` carries the solver metadata.
pub struct RuntimeSnapshot {
    /// The active robot model (built-in enum — keep for backward compat).
    pub robot: RobotModel,
    /// Full URDF model when the robot was imported; `None` for built-in robots.
    pub robot_source: Option<Robot>,
    /// Human-readable robot name (from built-in metadata or URDF).
    pub robot_name: String,
    /// Joint metadata — empty for built-in robots; populated for URDF imports.
    pub joints_meta: Vec<JointMeta>,
    /// Current joint angles.
    pub joints: Vec<f64>,
    /// The kinematic chain of the active robot.
    pub chain: SerialChain,
    /// The forward kinematics result computed from the current joints.
    pub fk_result: FKResult,
    /// Solver metadata when this snapshot was produced by an IK command.
    pub ik_result: Option<IKResult>,
    /// Active motion plan, if any (plan data + derived state).
    pub active_plan: Option<ActiveMotionPlan>,
    /// Execution session, if execution has been started.
    /// `None` before Start or after Reset/Cancel.
    pub execution: Option<ExecutionSession>,
    /// When this snapshot was taken.
    pub generated_at: DateTime<Utc>,
}

impl RuntimeSnapshot {
    /// Progress of the active plan's trajectory as a fraction 0.0–1.0.
    pub fn trajectory_progress(&self) -> Option<f64> {
        self.active_plan.as_ref().map(|p| p.progress())
    }
}
