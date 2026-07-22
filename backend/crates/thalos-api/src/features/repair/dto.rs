use serde::{Deserialize, Serialize};

/// Opción de reparación para una región.
#[derive(Debug, Serialize)]
pub struct RepairOptionDto {
    pub region_id: usize,
    pub strategy: String,
    pub status: String,
    pub improvement: f64,
    pub metrics_before: Option<MetricsSummary>,
    pub metrics_after: Option<MetricsSummary>,
}

/// Resumen de métricas para una reparación.
#[derive(Debug, Serialize)]
pub struct MetricsSummary {
    pub manipulability: f64,
    pub smoothness: f64,
}

/// Respuesta de /repair/options.
#[derive(Debug, Serialize)]
pub struct RepairOptionsResponse {
    pub repairs: Vec<RepairOptionDto>,
}

/// Solicitud para aplicar una reparación.
#[derive(Debug, Deserialize)]
pub struct RepairApplyRequest {
    pub plan_id: Option<String>,
    pub repair: RepairSelection,
}

/// Selección de reparación a aplicar.
#[derive(Debug, Deserialize)]
pub struct RepairSelection {
    pub region_id: usize,
    pub strategy: String,
}

/// Respuesta de /repair/apply.
#[derive(Debug, Serialize)]
pub struct RepairApplyResponse {
    pub plan_id: String,
    pub status: String,
    pub modified_range: Option<[usize; 2]>,
    pub metrics_delta: Option<MetricsDeltaDto>,
    pub reason: Option<String>,
}

/// Delta de métricas antes vs después.
#[derive(Debug, Serialize)]
pub struct MetricsDeltaDto {
    pub manipulability: MetricChange,
    pub singularity_count: MetricChange,
}

#[derive(Debug, Serialize)]
pub struct MetricChange {
    pub before: f64,
    pub after: f64,
}

// ── Repair Session DTOs (M8.4) ──

#[derive(Debug, Serialize)]
pub struct CreateSessionResponse {
    pub session_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct PreviewRequest {
    pub region_id: usize,
    pub strategy: String,
}

#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    pub candidate_id: u64,
    pub base_revision: u32,
    pub continuity_ok: bool,
    pub improvement: f64,
}

#[derive(Debug, Deserialize)]
pub struct ApplyRequest {
    pub candidate_id: u64,
}

#[derive(Debug, Serialize)]
pub struct ApplyResponse {
    pub new_revision: u32,
    pub status: String,
    pub history_length: usize,
}

#[derive(Debug, Serialize)]
pub struct SessionStatusResponse {
    pub session_id: u64,
    pub revision: u32,
    pub status: String,
    pub history_length: usize,
}
