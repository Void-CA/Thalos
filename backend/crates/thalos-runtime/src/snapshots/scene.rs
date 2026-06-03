use chrono::{DateTime, Utc};

use thalos_core::{
    kinematics::forward::result::FKResult,
    models::RobotModel,
    robot::serial_chain::SerialChain,
};

/// Immutable snapshot of the runtime state at a point in time.
///
/// Contains only domain state — no visual representation.
/// Visual scene construction is the responsibility of the API layer.
pub struct RuntimeSnapshot {
    /// The active robot model.
    pub robot: RobotModel,
    /// Current joint angles.
    pub joints: Vec<f64>,
    /// The kinematic chain of the active robot.
    pub chain: SerialChain,
    /// The forward kinematics result computed from the current joints.
    pub fk_result: FKResult,
    /// When this snapshot was taken.
    pub generated_at: DateTime<Utc>,
}
