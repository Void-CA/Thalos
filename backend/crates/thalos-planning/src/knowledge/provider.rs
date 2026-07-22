//! PlanningKnowledgeProvider — trait read-only para consultar conocimiento.
//!
//! Este es el contrato entre `knowledge/` y sus consumidores (`analysis/`, `repair/`).
//! El trait es propiedad de `knowledge/` — los consumidores solo lo importan.

use crate::knowledge::domain::{ConfigurationRegion, PlanningKnowledge, SingularityZone};
use thalos_math::Transform3D;

/// Proveedor de conocimiento precomputado del robot y su espacio de trabajo.
///
/// Read-only. No genera conocimiento. La generación pertenece a `KnowledgeBuilder`.
pub trait PlanningKnowledgeProvider {
    fn knowledge(&self) -> &PlanningKnowledge;
    fn reachability_at(&self, pose: &Transform3D) -> Option<f64>;
    fn manipulability_at(&self, joints: &[f64]) -> Option<f64>;
    fn nearby_singularity(&self, joints: &[f64]) -> Option<&SingularityZone>;
    fn preferred_configuration(&self, joints: &[f64]) -> Option<&ConfigurationRegion>;
}
