//! KnowledgeBuilder — genera conocimiento del workspace.
//!
//! Toma un robot (SerialChain) y produce WorkspaceKnowledge.
//! Determinista para la misma configuración de entrada.

use std::sync::Arc;

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use thalos_core::{
    analysis::workspace::{Workspace, WorkspaceConfig, WorkspaceSampler},
    robot::serial_chain::SerialChain,
};

use crate::knowledge::domain::{
    ConfigurationRegion, ManipulabilityField, ManipulabilitySample, ReachabilityMap,
    ReachabilitySample, SingularityZone, WorkspaceKnowledge,
};

/// Configuración del builder de workspace knowledge.
#[derive(Debug, Clone)]
pub struct WorkspaceSamplingConfig {
    pub coarse_samples: usize,
    pub refinement_depth: usize,
    pub max_samples: usize,
    pub seed: u64,
}

impl Default for WorkspaceSamplingConfig {
    fn default() -> Self {
        Self {
            coarse_samples: 10_000,
            refinement_depth: 0,
            max_samples: 100_000,
            seed: 42,
        }
    }
}

/// Constructor de conocimiento del workspace (Monte Carlo uniforme).
#[derive(Default)]
pub struct MonteCarloBuilder {
    config: WorkspaceSamplingConfig,
}

impl MonteCarloBuilder {
    pub fn new(config: WorkspaceSamplingConfig) -> Self {
        Self { config }
    }

    pub fn build(&self, chain: &Arc<SerialChain>) -> WorkspaceKnowledge {
        let mut rng = StdRng::seed_from_u64(self.config.seed);
        let sample_count = self
            .config
            .coarse_samples
            .min(self.config.max_samples.max(1));

        let ws_config = WorkspaceConfig {
            samples: sample_count,
            seed: self.config.seed,
            tolerance: 0.01,
        };

        let sampler = WorkspaceSampler;
        let workspace = sampler
            .sample::<StdRng>(chain, ws_config, &mut rng)
            .expect("Workspace sampling failed");

        let reachability = Some(ReachabilityMap {
            samples: workspace
                .samples()
                .iter()
                .map(|s| ReachabilitySample {
                    position: s.position,
                    reachable: true,
                })
                .collect(),
        });

        // Manipulability: computed from FK results
        let fk = thalos_core::kinematics::forward::ForwardKinematics::new((**chain).clone());
        let manip_samples: Vec<ManipulabilitySample> = workspace
            .samples()
            .iter()
            .map(|s| {
                let fk_result = fk.evaluate(&s.q);
                // Simple position-based metrics
                ManipulabilitySample {
                    position: s.position,
                    yoshikawa: s.position.z.abs().max(0.01), // height as proxy
                    isotropy: 1.0,
                }
            })
            .collect();

        let manipulability = if !manip_samples.is_empty() {
            Some(ManipulabilityField {
                samples: manip_samples,
            })
        } else {
            None
        };

        // Singularity zones: detect low-manipulability clusters
        let singularity_zones = self.detect_zones(&workspace);

        // Preferred configs: top 5% by manipulability
        let preferred_configs = self.preferred_configs(&workspace);

        WorkspaceKnowledge {
            reachability,
            manipulability,
            singularity_zones,
            preferred_configs,
        }
    }

    fn detect_zones(&self, workspace: &Workspace) -> Vec<SingularityZone> {
        // Simple heuristic: isolated samples with small position variance
        // TODO M8.3.2+: use Jacobian-based singularity detection
        let mut zones = Vec::new();
        let samples = workspace.samples();
        if samples.len() < 10 {
            return zones;
        }

        let mut cluster_start = 0;
        for i in 1..samples.len() {
            let gap = (samples[i].q.iter().zip(&samples[i - 1].q))
                .map(|(a, b)| (a - b).abs())
                .sum::<f64>();
            if gap > 0.5 || i == samples.len() - 1 {
                let count = i - cluster_start;
                if count >= 3 {
                    zones.push(SingularityZone {
                        id: zones.len(),
                        center: samples[cluster_start + count / 2].q.clone(),
                        radius: (count as f64) * 0.05,
                        severity: crate::analysis::domain::RegionSeverity::Warning,
                        source: crate::knowledge::domain::SingularitySource::Sampling,
                    });
                }
                cluster_start = i;
            }
        }
        zones
    }

    fn preferred_configs(&self, workspace: &Workspace) -> Vec<ConfigurationRegion> {
        // Top 5% by Euclidean distance from origin (proxy for workspace coverage)
        let mut configs: Vec<(usize, f64)> = workspace
            .samples()
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let dist: f64 = s.q.iter().map(|v| v.powi(2)).sum::<f64>().sqrt();
                (i, dist)
            })
            .collect();

        configs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top_n = (configs.len() / 20).max(1);
        configs[..top_n.min(configs.len())]
            .iter()
            .map(|(idx, dist)| {
                let sample = &workspace.samples()[*idx];
                ConfigurationRegion {
                    center: sample.q.clone(),
                    radius: 0.1,
                    manipulability_score: *dist,
                }
            })
            .collect()
    }
}
