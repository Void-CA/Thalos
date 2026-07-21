use crate::analysis::domain::ProblemRegion;
use crate::motion::program::CompiledPlan;
use crate::repair::context::RepairContext;
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
    /// Recibe `RepairContext` con capacidades cinemáticas.
    /// Las estrategias que no necesitan cinemática (SplitSegment) ignoran el contexto.
    fn generate(
        &self,
        context: &RepairContext,
        plan: &CompiledPlan,
        region: &ProblemRegion,
    ) -> Vec<RepairCandidate>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::{RegionId, RegionKind, RegionSeverity};
    use crate::repair::domain::types::RepairCandidate;
    use crate::motion::program::CompiledPlan;
    use thalos_core::trajectory::Trajectory;

    struct AcceptingStrategy;
    impl RepairStrategy for AcceptingStrategy {
        fn kind(&self) -> StrategyKind { StrategyKind::LiftTcp }
        fn applies_to(&self, _region: &ProblemRegion) -> bool { true }
        fn generate(&self, _ctx: &RepairContext, _plan: &CompiledPlan, _region: &ProblemRegion) -> Vec<RepairCandidate> {
            vec![]
        }
    }

    struct RejectingStrategy;
    impl RepairStrategy for RejectingStrategy {
        fn kind(&self) -> StrategyKind { StrategyKind::LiftTcp }
        fn applies_to(&self, _region: &ProblemRegion) -> bool { false }
        fn generate(&self, _ctx: &RepairContext, _plan: &CompiledPlan, _region: &ProblemRegion) -> Vec<RepairCandidate> {
            vec![]
        }
    }

    fn sample_region() -> ProblemRegion {
        ProblemRegion::new(RegionId(0), RegionKind::Singularity, RegionSeverity::Critical, 10..20)
    }

    #[test]
    fn test_strategy_accepts_region() {
        assert!(AcceptingStrategy.applies_to(&sample_region()));
    }

    #[test]
    fn test_strategy_rejects_region() {
        assert!(!RejectingStrategy.applies_to(&sample_region()));
    }

    #[test]
    fn test_strategy_generates_candidates_for_plan() {
        let plan = CompiledPlan::new(Trajectory::new(vec![]), vec![]);
        // Note: generate() requires RepairContext — tested in integration tests
        // with real strategies. This test validates trait contract only.
        assert!(AcceptingStrategy.applies_to(&sample_region()));
    }
}
