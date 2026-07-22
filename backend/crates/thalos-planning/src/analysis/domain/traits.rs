use crate::analysis::domain::types::{ProblemRegion, RegionKind};
use crate::analysis::PlanAnalysis;
use crate::knowledge::domain::{ConfigurationRegion, PlanningKnowledge, SingularityZone};
use crate::motion::program::CompiledPlan;
use thalos_math::Transform3D;

/// Contrato para la detección de regiones problemáticas a partir del análisis de un plan.
pub trait RegionDetector {
    fn detect(&self, analysis: &PlanAnalysis) -> Vec<ProblemRegion>;
}

/// Estrategia de reparación aplicable a una región problemática.
pub trait RepairCapability {
    fn kind(&self) -> StrategyKind;
    fn applies_to(&self, region: &ProblemRegion) -> bool;
    fn estimate_improvement(&self, region: &ProblemRegion) -> f64;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrategyKind {
    LiftTcp,
    RotateTool,
    SwitchIkBranch,
    SmoothOrientation,
    SplitSegment,
}

/// Proveedor de conocimiento precomputado del robot y su espacio de trabajo.
///
/// Read-only. No genera conocimiento.
pub trait PlanningKnowledgeProvider {
    fn knowledge(&self) -> &PlanningKnowledge;
    fn reachability_at(&self, pose: &Transform3D) -> Option<f64>;
    fn manipulability_at(&self, joints: &[f64]) -> Option<f64>;
    fn nearby_singularity(&self, joints: &[f64]) -> Option<&SingularityZone>;
    fn preferred_configuration(&self, joints: &[f64]) -> Option<&ConfigurationRegion>;
}
