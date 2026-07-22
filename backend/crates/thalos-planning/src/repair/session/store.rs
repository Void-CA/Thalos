//! Session store — almacén in-memory de sesiones y previews.

use std::collections::HashMap;

use super::domain::{RepairPreview, RepairSession, SessionId};

/// Almacén de sesiones de reparación.
///
/// Responsabilidades:
/// - Crear, obtener, cerrar, descartar sesiones
/// - Almacenar previews asociados a una sesión
/// - Invalidar previews cuando cambia la revisión
pub struct RepairSessionStore {
    sessions: HashMap<SessionId, RepairSession>,
    previews: HashMap<u64, RepairPreview>,
    next_session_id: u64,
    next_preview_id: u64,
}

impl RepairSessionStore {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            previews: HashMap::new(),
            next_session_id: 1,
            next_preview_id: 1,
        }
    }

    /// Crea una nueva sesión.
    pub fn create(&mut self, session: RepairSession) -> SessionId {
        let id = SessionId(self.next_session_id);
        self.next_session_id += 1;
        self.sessions.insert(id, session);
        id
    }

    /// Obtiene una sesión por ID.
    pub fn get(&self, id: &SessionId) -> Option<&RepairSession> {
        self.sessions.get(id)
    }

    /// Obtiene una sesión mutablemente por ID.
    pub fn get_mut(&mut self, id: &SessionId) -> Option<&mut RepairSession> {
        self.sessions.get_mut(id)
    }

    /// Elimina una sesión y sus previews asociados.
    pub fn delete(&mut self, id: &SessionId) -> bool {
        if self.sessions.remove(id).is_some() {
            self.previews.retain(|_, p| p.session_id != *id);
            true
        } else {
            false
        }
    }

    /// Almacena un preview y devuelve su candidate_id.
    pub fn store_preview(&mut self, mut preview: RepairPreview) -> u64 {
        let cid = self.next_preview_id;
        self.next_preview_id += 1;
        preview.candidate_id = cid;
        self.previews.insert(cid, preview);
        cid
    }

    /// Obtiene un preview por candidate_id.
    pub fn get_preview(&self, candidate_id: u64) -> Option<&RepairPreview> {
        self.previews.get(&candidate_id)
    }

    /// Invalida previews para una sesión (cuando cambia la revisión).
    pub fn invalidate_session_previews(&mut self, session_id: &SessionId) {
        self.previews.retain(|_, p| p.session_id != *session_id);
    }
}
