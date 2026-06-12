// Re-export from core — Trajectory is a domain primitive shared across
// planning, runtime, API, and visualisation. This module exists only to
// keep `crate::trajectory::*` working for existing code. New code should
// import directly from `thalos_core::trajectory`.
pub use thalos_core::trajectory::{Trajectory, TrajectoryPoint};
