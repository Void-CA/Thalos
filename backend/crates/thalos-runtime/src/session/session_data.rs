use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::motion_trace::MotionTrace;
use crate::plan::session_status::SessionStatus;

use super::execution_source::ExecutionSource;

/// Datos persistentes de una sesión de ejecución.
///
/// Es una entidad de negocio, NO derivada de RobotState.
/// Describe qué ocurrió, cuándo, con qué origen y resultado.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    /// ID numérico secuencial (Execution #15).
    pub id: u64,
    /// ID del plan que se ejecutó.
    pub plan_id: String,
    /// Origen de la ejecución.
    pub source: ExecutionSource,
    /// Estado final de la sesión.
    pub status: SessionStatus,
    /// Cuándo comenzó la ejecución.
    pub started_at: Option<DateTime<Utc>>,
    /// Cuándo se pausó (última pausa).
    pub paused_at: Option<DateTime<Utc>>,
    /// Cuándo terminó (completed, cancelled, failed).
    pub completed_at: Option<DateTime<Utc>>,
    /// Duración total de la trayectoria en segundos.
    pub duration: f64,
    /// Cantidad de articulaciones.
    pub joint_count: usize,
    /// Nombre del robot (para display).
    pub robot_name: String,
}

/// Una sesión completa con su trace asociado.
#[derive(Debug, Clone)]
pub struct SessionWithTrace {
    pub session: SessionData,
    pub trace: Option<MotionTrace>,
}
