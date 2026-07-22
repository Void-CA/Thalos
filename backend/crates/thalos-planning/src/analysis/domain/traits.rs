use crate::analysis::domain::types::{ProblemRegion, RegionKind};
use crate::analysis::PlanAnalysis;
use crate::motion::program::CompiledPlan;

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

// PlanningKnowledgeProvider ha migrado a `crate::knowledge::provider` (M8.3).
