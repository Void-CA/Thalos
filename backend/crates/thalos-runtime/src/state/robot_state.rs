use chrono::{DateTime, Utc};

/// Monotonic revision counter — every state change increments this.
pub type Revision = u64;

/// Single source of truth for the live robot condition.
///
/// `RuntimeSnapshot` and `TickDelta` are DERIVED from this struct,
/// never the other way around.
#[derive(Clone, Debug)]
pub struct RobotState {
    pub revision: Revision,
    pub motion: MotionState,
    pub joints: JointState,
    pub cartesian: CartesianState,
    pub devices: DeviceState,
    pub execution: ExecutionState,
    pub diagnostics: Diagnostics,
}

impl RobotState {
    pub fn new(state: Self) -> Self {
        Self { revision: 1, ..state }
    }
}

impl Default for RobotState {
    fn default() -> Self {
        Self {
            revision: 0,
            motion: MotionState::default(),
            joints: JointState::default(),
            cartesian: CartesianState::default(),
            devices: DeviceState::default(),
            execution: ExecutionState::default(),
            diagnostics: Diagnostics::default(),
        }
    }
}

// ── MotionState ──

#[derive(Clone, Debug, Default, PartialEq)]
pub enum MotionMode {
    #[default]
    Idle,
    Moving,
    Paused,
    Stopping,
    EStop,
}

#[derive(Clone, Debug)]
pub struct MotionState {
    pub mode: MotionMode,
    pub power_on: bool,
    pub motion_enabled: bool,
}

impl Default for MotionState {
    fn default() -> Self {
        Self {
            mode: MotionMode::Idle,
            power_on: false,
            motion_enabled: false,
        }
    }
}

// ── JointState ──

#[derive(Clone, Debug)]
pub struct JointState {
    pub positions: Vec<f64>,
    pub velocities: Vec<f64>,
    pub torques: Vec<f64>,
}

impl Default for JointState {
    fn default() -> Self {
        Self {
            positions: Vec::new(),
            velocities: Vec::new(),
            torques: Vec::new(),
        }
    }
}

impl JointState {
    /// All three vectors have the same length (DOF).
    /// Returns `true` if all match, `false` otherwise.
    pub fn is_consistent(&self) -> bool {
        let len = self.positions.len();
        self.velocities.len() == len && self.torques.len() == len
    }
}

// ── CartesianState ──

#[derive(Clone, Debug)]
pub struct CartesianState {
    /// translation xyz + quaternion wxyz
    pub tcp_pose: [f64; 7],
    /// linear xyz + angular xyz
    pub tcp_velocity: [f64; 6],
}

impl Default for CartesianState {
    fn default() -> Self {
        Self {
            tcp_pose: [0.0; 7],
            tcp_velocity: [0.0; 6],
        }
    }
}

// ── DeviceState ──

#[derive(Clone, Debug)]
pub struct DeviceState {
    pub digital_inputs: Vec<bool>,
    pub digital_outputs: Vec<bool>,
    /// `None` if the backend does not expose a gripper.
    pub gripper_position: Option<f64>,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self {
            digital_inputs: Vec::new(),
            digital_outputs: Vec::new(),
            gripper_position: None,
        }
    }
}

// ── ExecutionState ──

#[derive(Clone, Debug)]
pub struct ExecutionState {
    pub current_program: Option<String>,
    pub current_segment: Option<u32>,
    /// Progress as a fraction 0.0 ..= 1.0.
    pub progress: f64,
}

impl Default for ExecutionState {
    fn default() -> Self {
        Self {
            current_program: None,
            current_segment: None,
            progress: 0.0,
        }
    }
}

// ── Diagnostics ──

#[derive(Clone, Debug)]
pub struct Fault {
    pub code: String,
    pub message: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct Diagnostics {
    pub timestamp: DateTime<Utc>,
    pub faults: Vec<Fault>,
    pub last_error: Option<String>,
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            timestamp: Utc::now(),
            faults: Vec::new(),
            last_error: None,
        }
    }
}

// ── Increment revision helper (internal) ──

pub(crate) fn next_revision(state: &RobotState) -> Revision {
    state.revision + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_robot_state_is_well_formed() {
        let s = RobotState::default();
        assert_eq!(s.revision, 0);
        assert_eq!(s.motion.mode, MotionMode::Idle);
        assert!(!s.motion.power_on);
        assert!(s.joints.positions.is_empty());
        assert!(s.joints.is_consistent());
        assert_eq!(s.cartesian.tcp_pose, [0.0; 7]);
        assert_eq!(s.cartesian.tcp_velocity, [0.0; 6]);
        assert!(s.devices.gripper_position.is_none());
        assert!(s.execution.current_program.is_none());
        assert_eq!(s.execution.progress, 0.0);
        assert!(s.diagnostics.faults.is_empty());

        // Verify Send + Sync
        fn assert_send<T: Send>(_: &T) {}
        fn assert_sync<T: Sync>(_: &T) {}
        assert_send(&s);
        assert_sync(&s);
    }

    #[test]
    fn new_robot_state_starts_at_revision_1() {
        let s = RobotState::new(RobotState::default());
        assert_eq!(s.revision, 1);
    }

    #[test]
    fn motion_state_defaults() {
        let m = MotionState::default();
        assert_eq!(m.mode, MotionMode::Idle);
        assert!(!m.power_on);
    }

    #[test]
    fn joint_state_consistency() {
        let mut j = JointState::default();
        assert!(j.is_consistent()); // all empty → vacuous truth

        j.positions = vec![0.0, 1.0, 2.0];
        assert!(!j.is_consistent()); // velocities still empty

        j.velocities = vec![0.0, 1.0, 2.0];
        j.torques = vec![0.0, 1.0, 2.0];
        assert!(j.is_consistent());
    }

    #[test]
    fn diagnostics_timestamp_is_set_on_default() {
        let d = Diagnostics::default();
        // timestamp should be recent (within 1 second)
        let elapsed = Utc::now() - d.timestamp;
        assert!(elapsed.num_seconds() < 2);
    }

    #[test]
    fn faults_vec_is_empty_by_default() {
        let d = Diagnostics::default();
        assert!(d.faults.is_empty());
        assert!(d.last_error.is_none());
    }
}
