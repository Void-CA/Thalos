//! Tipos de dominio de la sesión de reparación.
//!
//! La sesión coordina una interacción completa: analizar → elegir → aplicar → validar.
//! `original_plan` es inmutable, `working_plan` es una caché coherente con la revisión actual.

use crate::evaluation::metrics::PlanMetrics;
use crate::motion::program::CompiledPlan;
use crate::repair::domain::types::{
    PlanDelta, RepairCandidate, RepairEvaluation, StrategyKind,
};
use crate::analysis::domain::RegionId;

/// Identificador de revisión del plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PlanRevision(pub u32);

/// Identificador de sesión.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId(pub u64);

/// Estado del ciclo de vida de una sesión.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepairSessionStatus {
    Active,
    Closed,
    Discarded,
}

/// Registro autosuficiente de una reparación aplicada.
#[derive(Debug, Clone)]
pub struct AppliedRepair {
    /// Revisión DESDE la que se aplicó (before).
    pub from_revision: PlanRevision,
    pub region_id: RegionId,
    pub strategy: StrategyKind,
    pub candidate: RepairCandidate,
    pub metrics_before: PlanMetrics,
    pub metrics_after: PlanMetrics,
}

/// Agregado principal: coordina una sesión de reparación.
#[derive(Debug, Clone)]
pub struct RepairSession {
    pub id: SessionId,
    /// Plan original — nunca cambia.
    pub original_plan: CompiledPlan,
    /// Plan de trabajo — caché coherente con `revision`.
    pub working_plan: CompiledPlan,
    /// Revisión actual.
    pub revision: PlanRevision,
    /// Historial append-only de reparaciones aplicadas.
    pub history: Vec<AppliedRepair>,
    /// Estado del ciclo de vida.
    pub status: RepairSessionStatus,
}

impl RepairSession {
    /// Crea una nueva sesión a partir de un plan.
    pub fn new(id: SessionId, plan: CompiledPlan) -> Self {
        Self {
            id,
            revision: PlanRevision(0),
            working_plan: plan.clone(),
            original_plan: plan,
            history: vec![],
            status: RepairSessionStatus::Active,
        }
    }

    /// Aplica una reparación, incrementa revisión y actualiza working_plan.
    pub fn apply(
        &mut self,
        region_id: RegionId,
        strategy: StrategyKind,
        candidate: RepairCandidate,
        new_plan: CompiledPlan,
        metrics_before: PlanMetrics,
        metrics_after: PlanMetrics,
    ) -> Result<PlanRevision, &'static str> {
        if self.status != RepairSessionStatus::Active {
            return Err("session is not active");
        }
        let from = self.revision;
        self.revision = PlanRevision(self.revision.0 + 1);
        self.working_plan = new_plan;
        self.history.push(AppliedRepair {
            from_revision: from,
            region_id,
            strategy,
            candidate,
            metrics_before,
            metrics_after,
        });
        Ok(self.revision)
    }

    /// Cierra la sesión. No admite más reparaciones.
    pub fn close(&mut self) {
        self.status = RepairSessionStatus::Closed;
    }

    /// Descarta la sesión.
    pub fn discard(&mut self) {
        self.status = RepairSessionStatus::Discarded;
    }
}

/// Resultado de evaluar una estrategia sin aplicarla.
#[derive(Debug, Clone)]
pub struct RepairPreview {
    pub session_id: SessionId,
    pub base_revision: PlanRevision,
    pub candidate_id: u64,
    pub delta: PlanDelta,
    pub evaluation: RepairEvaluation,
    pub continuity_ok: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::trajectory::Trajectory;
    use crate::repair::domain::types::RepairCandidate;

    fn empty_plan() -> CompiledPlan {
        CompiledPlan::new(Trajectory::new(vec![]), vec![])
    }

    fn dummy_metrics() -> PlanMetrics {
        use crate::evaluation::metrics::*;
        PlanMetrics {
            length: 0.0, waypoint_count: 0,
            manipulability: ManipulabilityMetrics { min: 0.0, average: 0.0, near_singular_count: 0, singular_count: 0 },
            joint_safety: JointSafetyMetrics { min_margin: 0.0, avg_max_utilization: 0.0, violation_count: 0 },
            collision: CollisionMetrics { min_distance: 0.0, collision_count: 0, near_miss_count: 0 },
            smoothness: 0.0, orientation_change: 0.0,
        }
    }

    #[test]
    fn test_session_starts_at_revision_zero() {
        let s = RepairSession::new(SessionId(1), empty_plan());
        assert_eq!(s.revision.0, 0);
        assert_eq!(s.status, RepairSessionStatus::Active);
    }

    #[test]
    fn test_apply_increments_revision() {
        let mut s = RepairSession::new(SessionId(1), empty_plan());
        let dm = dummy_metrics();
        let candidate = RepairCandidate::new(
            crate::repair::domain::types::StrategyKind::LiftTcp,
            crate::repair::domain::types::PlanDelta::new(
                crate::analysis::domain::RegionId(0), 0..10, Trajectory::new(vec![]),
            ).unwrap(),
        );
        s.apply(
            crate::analysis::domain::RegionId(0),
            crate::repair::domain::types::StrategyKind::LiftTcp,
            candidate,
            empty_plan(),
            dm.clone(), dm.clone(),
        ).unwrap();
        assert_eq!(s.revision.0, 1);
        assert_eq!(s.history.len(), 1);
    }

    #[test]
    fn test_original_plan_unchanged() {
        let original = empty_plan();
        let mut s = RepairSession::new(SessionId(1), original.clone());
        let dm = dummy_metrics();
        let candidate = RepairCandidate::new(
            crate::repair::domain::types::StrategyKind::LiftTcp,
            crate::repair::domain::types::PlanDelta::new(
                crate::analysis::domain::RegionId(0), 0..10, Trajectory::new(vec![]),
            ).unwrap(),
        );
        let new_plan = CompiledPlan::new(Trajectory::new(vec![
            thalos_core::trajectory::TrajectoryPoint::new(vec![1.0], 0.0),
        ]), vec![]);
        s.apply(
            crate::analysis::domain::RegionId(0),
            crate::repair::domain::types::StrategyKind::LiftTcp,
            candidate,
            new_plan,
            dm.clone(), dm,
        ).unwrap();
        assert_eq!(s.original_plan.waypoint_count, original.waypoint_count);
        assert_eq!(s.working_plan.waypoint_count, 1);
    }

    #[test]
    fn test_closed_session_rejects_apply() {
        let mut s = RepairSession::new(SessionId(1), empty_plan());
        s.close();
        let dm = dummy_metrics();
        let candidate = RepairCandidate::new(
            crate::repair::domain::types::StrategyKind::LiftTcp,
            crate::repair::domain::types::PlanDelta::new(
                crate::analysis::domain::RegionId(0), 0..10, Trajectory::new(vec![]),
            ).unwrap(),
        );
        let dm2 = dummy_metrics();
        let result = s.apply(
            crate::analysis::domain::RegionId(0),
            crate::repair::domain::types::StrategyKind::LiftTcp,
            candidate,
            empty_plan(),
            dm, dm2,
        );
        assert!(result.is_err());
    }
}
