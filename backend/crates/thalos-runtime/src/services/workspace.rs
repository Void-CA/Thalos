use std::sync::Arc;

use rand::rngs::StdRng;
use rand::SeedableRng;

use thalos_core::analysis::workspace::{
    sampler::WorkspaceSampler, Workspace, WorkspaceConfig, WorkspaceError,
};
use thalos_core::math::geometry::vectors::Vector3;
use thalos_core::models::{RobotModel, RobotRegistry};

use crate::error::RuntimeError;

/// Stateless service for workspace sampling and reachability queries.
pub struct WorkspaceService;

impl WorkspaceService {
    pub fn sample(
        model: RobotModel,
        config: WorkspaceConfig,
    ) -> Result<Arc<Workspace>, RuntimeError> {
        if config.samples == 0 {
            return Err(RuntimeError::Workspace(WorkspaceError::InvalidSampleCount(0)));
        }

        let chain = RobotRegistry::create_default(model);
        let mut rng = StdRng::seed_from_u64(config.seed);

        let ws = WorkspaceSampler
            .sample(&chain, config, &mut rng)
            .map_err(RuntimeError::Workspace)?;

        Ok(Arc::new(ws))
    }

    /// Check whether a point is reachable within `tolerance`.
    ///
    /// Pure delegation to `Workspace::is_reachable`.
    pub fn query(
        workspace: &Workspace,
        point: &Vector3,
        tolerance: f64,
    ) -> Result<thalos_core::analysis::workspace::Reachability, WorkspaceError> {
        workspace.is_reachable(point, tolerance)
    }
}
