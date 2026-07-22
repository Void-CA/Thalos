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
