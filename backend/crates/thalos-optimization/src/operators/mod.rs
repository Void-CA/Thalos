//! Optimization operators — concrete implementations of the
//! [`TrajectoryOperator`] trait.
//!
//! Each operator implements a specific optimization strategy that can
//! be applied to a problem region within a trajectory.

pub mod joint_centering;
pub mod sampling;

pub mod nullspace;

pub use joint_centering::JointCenteringOperator;
pub use nullspace::NullSpaceOptimization;
pub use sampling::AdaptiveSampling;
