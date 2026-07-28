pub mod adapters;
pub mod advisor;
pub mod analysis;
pub mod collision;
pub mod error;
pub mod evaluation;
pub mod feedback;
pub mod finding;
pub mod goal;
pub mod interpolate;
pub mod knowledge;
pub mod motion;
pub mod optimizer;
pub mod repair;
pub mod trajectory;

// Re-export key optimization types for use by API crate consumers
pub use thalos_optimization::{domain::TrajectoryOperator, operators::JointCenteringOperator};
