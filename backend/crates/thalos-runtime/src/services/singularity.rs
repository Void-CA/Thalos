use rand::rngs::StdRng;
use rand::SeedableRng;

use thalos_core::analysis::singularity::{
    SingularityAnalysis, SingularityAnalyzer, SingularityConfig,
};
use thalos_core::analysis::workspace::{
    sampler::WorkspaceSampler, WorkspaceConfig, WorkspaceError,
};
use thalos_core::kinematics::forward::ForwardKinematics;
use thalos_core::kinematics::jacobian::GeometricJacobian;
use thalos_core::models::{RobotModel, RobotRegistry};
use thalos_core::robot::serial_chain::SerialChain;

use crate::error::RuntimeError;

pub struct SingularityService;

impl SingularityService {
    pub fn analyze(
        model: RobotModel,
        config: WorkspaceConfig,
        singularity_config: SingularityConfig,
    ) -> Result<SingularityAnalysis, RuntimeError> {
        if config.samples == 0 {
            return Err(RuntimeError::Workspace(WorkspaceError::InvalidSampleCount(0)));
        }

        let chain = RobotRegistry::create_default(model);
        Self::analyze_from_chain(&chain, config, singularity_config)
    }

    pub fn analyze_from_chain(
        chain: &SerialChain,
        config: WorkspaceConfig,
        singularity_config: SingularityConfig,
    ) -> Result<SingularityAnalysis, RuntimeError> {
        if config.samples == 0 {
            return Err(RuntimeError::Workspace(WorkspaceError::InvalidSampleCount(0)));
        }

        let mut rng = StdRng::seed_from_u64(config.seed);

        let ws = WorkspaceSampler
            .sample(chain, config, &mut rng)
            .map_err(RuntimeError::Workspace)?;

        let fk = ForwardKinematics::new(chain.clone());
        let jac = GeometricJacobian::new(fk, chain.end_effector.clone());

        let analysis = SingularityAnalyzer::analyze(&ws, &jac, &singularity_config);

        Ok(analysis)
    }
}
