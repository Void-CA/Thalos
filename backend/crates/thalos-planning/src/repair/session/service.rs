//! RepairSessionService — orquesta las operaciones de sesión.
//!
//! Posee el store, planner y merger. Los handlers solo llaman métodos.

use crate::analysis::domain::{ProblemRegion, RegionId};
use crate::evaluation::metrics::PlanMetrics;
use crate::motion::program::CompiledPlan;
use crate::repair::{
    context::RepairContext,
    domain::{
        traits::RepairStrategy,
        types::{RepairCandidate, StrategyKind},
    },
    merger::PlanMerger,
    planner::RepairPlanner,
    session::{
        domain::{PlanRevision, RepairPreview, RepairSession, RepairSessionStatus, SessionId},
        store::RepairSessionStore,
    },
};

/// Resultado de aplicar una reparación.
#[derive(Debug)]
pub struct ApplyResult {
    pub new_revision: PlanRevision,
    pub session: RepairSession,
}

/// Servicio de sesiones de reparación.
///
/// Encapsula store, planner y merger. Los handlers no conocen estas dependencias.
pub struct RepairSessionService {
    pub store: RepairSessionStore,
    planner: RepairPlanner,
}

impl RepairSessionService {
    pub fn new(strategies: Vec<Box<dyn RepairStrategy>>) -> Self {
        Self {
            store: RepairSessionStore::new(),
            planner: RepairPlanner::new(strategies),
        }
    }

    /// Crea una nueva sesión a partir de un plan.
    pub fn create_session(&mut self, plan: CompiledPlan) -> SessionId {
        let session = RepairSession::new(SessionId(0), plan);
        self.store.create(session)
    }

    /// Genera un preview para una estrategia sobre una sesión.
    pub fn preview(
        &self,
        session_id: SessionId,
        context: &RepairContext,
        region: &ProblemRegion,
        strategy: &dyn RepairStrategy,
    ) -> Option<RepairPreview> {
        let session = self.store.get(&session_id)?;
        if session.status != RepairSessionStatus::Active {
            return None;
        }

        let candidates = strategy.generate(context, &session.working_plan, region);
        let candidate = candidates.into_iter().next()?;
        let eval = candidate.evaluation.as_ref()?;
        let delta = candidate.delta.clone();
        let continuity_ok = PlanMerger::apply(&session.working_plan, &delta).is_ok();

        Some(RepairPreview {
            session_id,
            base_revision: session.revision,
            candidate_id: 0,
            delta,
            evaluation: eval.clone(),
            continuity_ok,
        })
    }

    /// Aplica una reparación de una sesión.
    pub fn apply(
        &mut self,
        session_id: SessionId,
        region_id: RegionId,
        strategy: StrategyKind,
        candidate: RepairCandidate,
        metrics_before: PlanMetrics,
        metrics_after: PlanMetrics,
    ) -> Result<ApplyResult, &'static str> {
        let working_plan = {
            let s = self.store.get(&session_id).ok_or("session not found")?;
            s.working_plan.clone()
        };
        let delta = &candidate.delta;
        let new_plan = PlanMerger::apply(&working_plan, delta).map_err(|_| "merge failed")?;

        let revision = {
            let session = self.store.get_mut(&session_id).ok_or("session not found")?;
            session.apply(region_id, strategy, candidate, new_plan, metrics_before, metrics_after)?
        };

        self.store.invalidate_session_previews(&session_id);

        let session = self.store.get(&session_id).ok_or("session not found")?.clone();
        Ok(ApplyResult { new_revision: revision, session })
    }

    /// Cierra una sesión.
    pub fn close_session(&mut self, session_id: SessionId) -> bool {
        self.store.get_mut(&session_id).map(|s| { s.close(); true }).unwrap_or(false)
    }

    /// Descarta una sesión.
    pub fn discard_session(&mut self, session_id: SessionId) -> bool {
        self.store.delete(&session_id)
    }

    /// Deshace la última reparación. Reconstruye desde original_plan + history[..N-1].
    pub fn undo(&mut self, session_id: SessionId) -> Result<PlanRevision, &'static str> {
        // 1. Extraer datos antes de mutar
        let (original_plan, to_replay) = {
            let s = self.store.get(&session_id).ok_or("session not found")?;
            if s.status != RepairSessionStatus::Active {
                return Err("session not active");
            }
            if s.history.is_empty() {
                return Err("nothing to undo");
            }
            let n = s.history.len() - 1;
            (s.original_plan.clone(), s.history[..n].to_vec())
        };

        // 2. Reconstruir working_plan replayando N-1 reparaciones
        let mut working_plan = original_plan;
        for repair in &to_replay {
            working_plan = PlanMerger::apply(&working_plan, &repair.candidate.delta)
                .map_err(|_| "merge failed during undo rebuild")?;
        }

        // 3. Actualizar sesión e invalidar previews
        let new_revision = PlanRevision(to_replay.len() as u32);
        {
            let session = self.store.get_mut(&session_id).ok_or("session not found")?;
            session.working_plan = working_plan;
            session.revision = new_revision;
            session.history.truncate(to_replay.len());
        }
        self.store.invalidate_session_previews(&session_id);

        Ok(new_revision)
    }

    /// Obtiene una sesión (solo lectura).
    pub fn get_session(&self, session_id: SessionId) -> Option<&RepairSession> {
        self.store.get(&session_id)
    }
}
