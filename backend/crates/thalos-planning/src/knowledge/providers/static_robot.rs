//! Proveedor de conocimiento estático del robot.
//!
//! Siempre disponible. No requiere sampling.
//! `knowledge().workspace` es siempre `None`.

use crate::knowledge::domain::{
    ConfigurationRegion, JointLimit, PlanningKnowledge, RobotKnowledge, SingularityZone,
};
use crate::knowledge::provider::PlanningKnowledgeProvider;
use thalos_core::robot::serial_chain::SerialChain;
use thalos_math::Transform3D;

/// Proveedor de conocimiento basado únicamente en el modelo del robot.
pub struct StaticRobotKnowledge {
    knowledge: PlanningKnowledge,
}

impl StaticRobotKnowledge {
    pub fn new(chain: &SerialChain) -> Self {
        let dof = chain.dof_count();
        let joint_limits: Vec<JointLimit> = chain
            .segments
            .iter()
            .filter(|s| s.joint.dof() > 0)
            .map(|s| {
                let l = s.joint.limits();
                JointLimit {
                    min: l.min,
                    max: l.max,
                }
            })
            .collect();

        let tcp_frame = chain.end_effector().clone();

        Self {
            knowledge: PlanningKnowledge {
                robot: RobotKnowledge {
                    dof,
                    joint_limits,
                    tcp_frame,
                },
                workspace: None,
            },
        }
    }
}

impl PlanningKnowledgeProvider for StaticRobotKnowledge {
    fn knowledge(&self) -> &PlanningKnowledge {
        &self.knowledge
    }

    fn reachability_at(&self, _pose: &Transform3D) -> Option<f64> {
        None // no workspace knowledge
    }

    fn manipulability_at(&self, _joints: &[f64]) -> Option<f64> {
        None // no workspace knowledge
    }

    fn nearby_singularity(&self, _joints: &[f64]) -> Option<&SingularityZone> {
        None // no workspace knowledge — zonas no generadas
    }

    fn preferred_configuration(&self, _joints: &[f64]) -> Option<&ConfigurationRegion> {
        None // no workspace knowledge
    }
}
