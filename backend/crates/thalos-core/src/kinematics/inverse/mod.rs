pub mod result;
pub mod solver;
pub mod solvers;
pub mod singularity;

pub use result::{IKResult, IKStatus};
pub use solver::{IKGoal, IKSolver};
pub use solvers::{DampedLeastSquaresSolver, JacobianTransposeSolver};
pub use singularity::SingularityReport;

#[cfg(test)]
pub mod tests;
