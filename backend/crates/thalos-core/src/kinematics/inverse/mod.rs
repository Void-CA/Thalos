pub mod error;
pub mod result;
pub mod solver;
pub mod solvers;

pub use error::IkError;
pub use result::{IKResult, IKStatus};
pub use solver::{IKGoal, IKSolver};
pub use solvers::{DampedLeastSquaresSolver, JacobianTransposeSolver};

// Re-export from kinematics::jacobian for backward compat
pub use crate::kinematics::jacobian::SingularityReport;

#[cfg(test)]
pub mod tests;
