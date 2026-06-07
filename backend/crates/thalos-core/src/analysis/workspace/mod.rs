//! Workspace analysis module.
//!
//! Re-exports the public types for ergonomic use:
//! ```ignore
//! use thalos_core::analysis::workspace::{Workspace, WorkspaceConfig, ...};
//! ```

pub mod config;
pub mod error;
pub mod reachability;
pub mod sampler;
pub mod types;
pub mod workspace;

#[cfg(test)]
mod error_tests;
#[cfg(test)]
mod reachability_tests;
#[cfg(test)]
mod sampler_tests;
#[cfg(test)]
mod types_tests;
#[cfg(test)]
mod workspace_tests;

pub use config::WorkspaceConfig;
pub use error::WorkspaceError;
pub use reachability::Reachability;
pub use sampler::WorkspaceSampler;
pub use types::{BoundingBox, WorkspaceKey, WorkspaceMetrics, WorkspaceSample};
pub use workspace::Workspace;
