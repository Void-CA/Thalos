use crate::analysis::domain::types::ProblemRegion;

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
// El contrato `RegionDetector` fue eliminado en PR 7a: la agrupación de
// regiones contiguas tiene UN único dueño, el `RegionGrouper` de
// `thalos-core` (sobre el lenguaje de observaciones).
