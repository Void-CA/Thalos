pub mod adapters;
pub mod advisor;
pub mod analysis;
pub mod error;
pub mod evaluation;
pub mod execution_plan_builder;
pub mod feedback;
pub mod goal;
pub mod interpolate;
pub mod motion;
pub mod optimizer;
pub mod program_edit;
pub mod recommendation;
pub mod repair;
pub mod resolver;
pub mod timeline;

// Re-export key optimization types for use by API crate consumers
pub use thalos_optimization::{domain::TrajectoryOperator, operators::JointCenteringOperator};
