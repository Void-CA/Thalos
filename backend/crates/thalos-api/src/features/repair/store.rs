use std::collections::HashMap;
use std::sync::RwLock;

use thalos_planning::repair::domain::types::RepairCandidate;

/// Identificador único de candidato de reparación.
pub type CandidateId = u64;

/// Almacén temporal de candidatos entre /repair/options y /repair/apply.
///
/// Los candidatos se generan en options() y se recuperan en apply().
/// No hay persistencia — el almacén vive mientras el servicio está activo.
pub struct RepairSessionStore {
    candidates: RwLock<HashMap<CandidateId, RepairCandidate>>,
    next_id: RwLock<CandidateId>,
}

impl RepairSessionStore {
    pub fn new() -> Self {
        Self {
            candidates: RwLock::new(HashMap::new()),
            next_id: RwLock::new(1),
        }
    }

    /// Almacena un candidato y devuelve su ID.
    pub fn store(&self, candidate: RepairCandidate) -> CandidateId {
        let mut id = self.next_id.write().unwrap();
        let cid = *id;
        *id += 1;
        self.candidates.write().unwrap().insert(cid, candidate);
        cid
    }

    /// Recupera un candidato por ID.
    pub fn retrieve(&self, id: CandidateId) -> Option<RepairCandidate> {
        self.candidates.read().unwrap().get(&id).cloned()
    }

    /// Almacena múltiples candidatos y devuelve sus IDs.
    pub fn store_many(&self, candidates: Vec<RepairCandidate>) -> Vec<CandidateId> {
        candidates.into_iter().map(|c| self.store(c)).collect()
    }
}
