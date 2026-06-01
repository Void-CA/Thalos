mod internal;

pub use internal::InternalBackend;

use thalos_core::models::RobotModel;

use crate::error::RuntimeError;

/// Strategy for resolving robot models from identifiers.
///
/// The default implementation is [`InternalBackend`], which resolves against
/// the built-in robot catalog in `thalos-core`. Custom backends can integrate
/// external sources (hardware discovery, config files, network, etc.).
pub trait RobotBackend: Send + Sync {
    /// Resolve a robot model by its string identifier.
    fn resolve_model(&self, id: &str) -> Result<RobotModel, RuntimeError>;
}
