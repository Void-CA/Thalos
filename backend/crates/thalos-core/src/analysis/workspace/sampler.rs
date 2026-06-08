//! Monte Carlo sampler for joint configurations.
//!
//! Given a `SerialChain` and a `WorkspaceConfig`, the sampler produces a
//! `Workspace` of `samples` configurations uniformly distributed over the
//! robot's joint limits (D6: sequential, no parallelism). The RNG is
//! injected so determinism (R1) is testable.

use rand::{Rng, SeedableRng};

use crate::robot::joint::JointLimits;
use crate::robot::serial_chain::SerialChain;

use super::error::WorkspaceError;
use super::types::WorkspaceSample;
use super::workspace::Workspace;
use super::WorkspaceConfig;

pub struct WorkspaceSampler;

impl WorkspaceSampler {
    /// Sample `config.samples` joint configurations uniformly within the
    /// joint limits, evaluate FK on each, and build a `Workspace`.
    ///
    /// The RNG is injected by the caller so tests can fix the seed
    /// and assert determinism (R1).
    pub fn sample<R: Rng + SeedableRng>(
        &self,
        chain: &SerialChain,
        config: WorkspaceConfig,
        rng: &mut R,
    ) -> Result<Workspace, WorkspaceError> {
        if config.samples == 0 {
            return Err(WorkspaceError::InvalidSampleCount(0));
        }

        let mut samples = Vec::with_capacity(config.samples);

        for _ in 0..config.samples {
            // Sample a random q within each joint's limits (R6).
            let mut q = Vec::with_capacity(chain.segments.len());
            for segment in &chain.segments {
                let limits = segment.joint.limits();
                let q_i = uniform_within(rng, limits);
                q.push(q_i);
            }

            // FK (R2: position == FK(q).ee_position()).
            // We re-construct FK per sample so the caller's chain is
            // untouched (D14 immutability of input).
            let fk = crate::kinematics::forward::ForwardKinematics::new(chain.clone());
            let result = fk.evaluate(&q);
            let position = result
                .ee_position()
                .ok_or_else(|| WorkspaceError::EmptyWorkspace)?; // unreachable for valid chains

            samples.push(WorkspaceSample { q, position });
        }

        Workspace::from_samples(samples)
    }
}


fn uniform_within<R: Rng>(rng: &mut R, limits: JointLimits) -> f64 {
    limits.min + rand::Rng::r#gen::<f64>(rng) * (limits.max - limits.min)
}
