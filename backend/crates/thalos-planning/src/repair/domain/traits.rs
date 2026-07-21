use crate::analysis::domain::ProblemRegion;
use thalos_core::trajectory::Trajectory;
use crate::motion::program::CompiledPlan;
use super::types::{RepairCandidate, StrategyKind};

/// Contrato para estrategias de reparación.
///
/// Cada estrategia propone candidatos. No evalúa ni aplica.
/// La evaluación es responsabilidad de `EvaluationPipeline`.
/// La aplicación es responsabilidad de `PlanMerger`.
pub trait RepairStrategy {
    /// Identificador único del tipo de estrategia.
    fn kind(&self) -> StrategyKind;

    /// Determina si esta estrategia es aplicable a la región dada.
    fn applies_to(&self, region: &ProblemRegion) -> bool;

    /// Genera candidatos de reparación para una región.
    ///
    /// Los candidatos NO están evaluados — `evaluation` es `None`.
    fn generate(&self, plan: &CompiledPlan, region: &ProblemRegion) -> Vec<RepairCandidate>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::{ProblemRegion, RegionId, RegionKind, RegionSeverity};

    struct AcceptingStrategy;
    impl RepairStrategy for AcceptingStrategy {
        fn kind(&self) -> StrategyKind { StrategyKind::LiftTcp }
        fn applies_to(&self, _region: &ProblemRegion) -> bool { true }
        fn generate(&self, _plan: &CompiledPlan, _region: &ProblemRegion) -> Vec<RepairCandidate> {
            vec![] // no-op for trait contract test
        }
    }

    struct RejectingStrategy;
    impl RepairStrategy for RejectingStrategy {
        fn kind(&self) -> StrategyKind { StrategyKind::LiftTcp }
        fn applies_to(&self, _region: &ProblemRegion) -> bool { false }
        fn generate(&self, _plan: &CompiledPlan, _region: &ProblemRegion) -> Vec<RepairCandidate> {
            vec![]
        }
    }

    fn sample_region() -> ProblemRegion {
        ProblemRegion::new(RegionId(0), RegionKind::Singularity, RegionSeverity::Critical, 10..20)
    }

    #[test]
    fn test_strategy_accepts_region() {
        let region = sample_region();
        assert!(AcceptingStrategy.applies_to(&region));
    }

    #[test]
    fn test_strategy_rejects_region() {
        let region = sample_region();
        assert!(!RejectingStrategy.applies_to(&region));
    }

    #[test]
    fn test_strategy_generates_candidates() {
        let region = sample_region();
        let plan = CompiledPlan::new(Trajectory::new(vec![]), vec![]);
        let candidates = AcceptingStrategy.generate(&plan, &region);
        // Contract: returns Vec (may be empty)
        assert!(candidates.is_empty());
    }
}
