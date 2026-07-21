use crate::analysis::domain::types::{ProblemRegion, RegionKind};
use crate::analysis::PlanAnalysis;
use crate::motion::program::CompiledPlan;
use thalos_math::Transform3D;

/// Contrato para la detección de regiones problemáticas a partir del análisis de un plan.
///
/// Sin implementación en M8.0. Las implementaciones concretas aparecen en M8.1.
pub trait RegionDetector {
    /// Detecta regiones problemáticas a partir del análisis completo de un plan.
    fn detect(&self, analysis: &PlanAnalysis) -> Vec<ProblemRegion>;
}

/// Estrategia de reparación aplicable a una región problemática.
///
/// Sin implementación en M8.0. Las implementaciones concretas aparecen en M8.2.
pub trait RepairCapability {
    /// Identificador único del tipo de estrategia.
    fn kind(&self) -> StrategyKind;
    /// Determina si esta estrategia es aplicable a la región dada.
    fn applies_to(&self, region: &ProblemRegion) -> bool;
    /// Estima la mejora potencial (0.0..1.0) sin ejecutar la reparación.
    fn estimate_improvement(&self, region: &ProblemRegion) -> f64;
}

/// Tipo de estrategia de reparación.
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
/// Sin implementación en M8.0. Las implementaciones concretas aparecen en M8.3.
pub trait PlanningKnowledgeProvider {
    /// Consulta de alcanzabilidad en una pose dada.
    fn reachability_at(&self, pose: &Transform3D) -> Option<f64>;
    /// Consulta de manipulabilidad en una configuración articular dada.
    fn manipulability_at(&self, q: &[f64]) -> Option<f64>;
    /// Devuelve las zonas de singularidad conocidas.
    fn singularity_zones(&self) -> &[SingularityZone];
}

/// Zona de singularidad precomputada.
#[derive(Debug, Clone)]
pub struct SingularityZone {
    pub center: Vec<f64>,
    pub radius: f64,
    pub condition_number_threshold: f64,
}
