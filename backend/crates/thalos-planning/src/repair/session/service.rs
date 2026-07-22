//! RepairSessionService — orquesta las operaciones de sesión entre
//! el store, el planner y el merger. Los handlers HTTP dependen de este
//! servicio, no del store directamente.

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
        domain::{
            PlanRevision, RepairPreview, RepairSession, RepairSessionStatus, SessionId,
        },
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
/// Los handlers HTTP llaman a este servicio. El servicio no conoce HTTP.
pub struct RepairSessionService {
    pub store: RepairSessionStore,
}

impl RepairSessionService {
    pub fn new() -> Self {
        Self {
            store: RepairSessionStore::new(),
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
        planner: &RepairPlanner,
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

        // Verificar continuidad vía PlanMerger
        let continuity_ok = PlanMerger::apply(&session.working_plan, &delta).is_ok();

        Some(RepairPreview {
            session_id,
            base_revision: session.revision,
            candidate_id: 0, // será asignado por el store
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
        // 1. Clonar working_plan antes de mutar
        let working_plan = {
            let s = self.store.get(&session_id).ok_or("session not found")?;
            s.working_plan.clone()
        };
        let delta = &candidate.delta;
        let new_plan = PlanMerger::apply(&working_plan, delta).map_err(|_| "merge failed")?;

        // 2. Mutar sesión
        let revision = {
            let session = self.store.get_mut(&session_id).ok_or("session not found")?;
            session.apply(region_id, strategy, candidate, new_plan, metrics_before, metrics_after)?
        };

        // 3. Invalidar previews
        self.store.invalidate_session_previews(&session_id);

        // 4. Obtener resultado
        let session = self.store.get(&session_id).ok_or("session not found")?.clone();
        Ok(ApplyResult { new_revision: revision, session })
    }

    /// Cierra una sesión.
    pub fn close_session(&mut self, session_id: SessionId) -> bool {
        if let Some(s) = self.store.get_mut(&session_id) {
            s.close();
            true
        } else {
            false
        }
    }

    /// Descarta una sesión.
    pub fn discard_session(&mut self, session_id: SessionId) -> bool {
        self.store.delete(&session_id)
    }
}
