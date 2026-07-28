//! Proveedor de conocimiento del workspace.
//!
//! Envuelve un `WorkspaceKnowledge` ya construido y responde consultas
//! espaciales (alcanzabilidad, manipulabilidad, singularidad).
//!
//! No genera muestras. La generación pertenece a `KnowledgeBuilder` (M8.3.2).

use crate::knowledge::domain::{
    ConfigurationRegion, PlanningKnowledge, SingularityZone, WorkspaceKnowledge,
};
use crate::knowledge::provider::PlanningKnowledgeProvider;
use thalos_math::{Transform3D, Vector3};

/// Proveedor que consulta un `WorkspaceKnowledge` ya generado.
pub struct WorkspaceKnowledgeProvider {
    knowledge: PlanningKnowledge,
    workspace: WorkspaceKnowledge,
}

impl WorkspaceKnowledgeProvider {
    /// Crea un provider a partir de un `PlanningKnowledge` que contiene
    /// workspace knowledge.
    ///
    /// # Panics
    /// En debug, si `knowledge.workspace` es `None`.
    pub fn new(knowledge: PlanningKnowledge) -> Self {
        let workspace = knowledge
            .workspace
            .clone()
            .expect("WorkspaceKnowledgeProvider requires workspace knowledge");
        Self {
            knowledge,
            workspace,
        }
    }
}

impl PlanningKnowledgeProvider for WorkspaceKnowledgeProvider {
    fn knowledge(&self) -> &PlanningKnowledge {
        &self.knowledge
    }

    fn reachability_at(&self, pose: &Transform3D) -> Option<f64> {
        let map = self.workspace.reachability.as_ref()?;
        if map.samples.is_empty() {
            return None;
        }
        // Nearest-neighbor query por posición
        let pos = pose.translation;
        let nearest = map.samples.iter().min_by(|a, b| {
            dist2(a.position, pos)
                .partial_cmp(&dist2(b.position, pos))
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
        Some(if nearest.reachable { 1.0 } else { 0.0 })
    }

    fn manipulability_at(&self, _joints: &[f64]) -> Option<f64> {
        let field = self.workspace.manipulability.as_ref()?;
        if field.samples.is_empty() {
            return None;
        }
        // Promedio simple de yoshikawa sobre todas las muestras
        let sum: f64 = field.samples.iter().map(|s| s.yoshikawa).sum();
        Some(sum / field.samples.len() as f64)
    }

    fn nearby_singularity(&self, joints: &[f64]) -> Option<&SingularityZone> {
        self.workspace
            .singularity_zones
            .iter()
            .find(|zone| zone.contains(joints))
    }

    fn preferred_configuration(&self, _joints: &[f64]) -> Option<&ConfigurationRegion> {
        self.workspace.preferred_configs.iter().max_by(|a, b| {
            a.manipulability_score
                .partial_cmp(&b.manipulability_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    }
}

fn dist2(a: Vector3, b: Vector3) -> f64 {
    (a.x - b.x).powi(2) + (a.y - b.y).powi(2) + (a.z - b.z).powi(2)
}
