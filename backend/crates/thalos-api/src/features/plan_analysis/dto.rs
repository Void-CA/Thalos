//! DTOs para el endpoint de análisis de planes.
//!
//! Estructura de respuesta:
//! ```json
//! {
//!   "summary": { "status", "score" },
//!   "metrics": { "duration", "manipulability", ... },
//!   "findings": [ ... ],
//!   "recommendations": [ ... ]
//! }
//! ```

use serde::{Deserialize, Serialize};
use thalos_planning::{
    advisor::{Impact, Recommendation, SuggestionKind},
    finding::{Finding, FindingKind, Severity},
};

/// Request para analizar un plan activo.
#[derive(Debug, Deserialize)]
pub struct PlanAnalysisRequest {
    /// ID del plan activo a analizar (opcional — si no se especifica,
    /// analiza el plan activo del runtime).
    pub plan_id: Option<String>,
}

/// Respuesta completa del análisis de un plan.
#[derive(Debug, Serialize)]
pub struct PlanAnalysisResponse {
    /// Resumen ejecutivo del análisis.
    pub summary: SummaryDto,
    /// Métricas agregadas de la trayectoria.
    pub metrics: MetricsDto,
    /// Hallazgos objetivos detectados.
    pub findings: Vec<FindingDto>,
    /// Recomendaciones accionables.
    pub recommendations: Vec<RecommendationDto>,
}

/// Resumen ejecutivo.
#[derive(Debug, Serialize)]
pub struct SummaryDto {
    /// Estado general: "ok", "warning", "error"
    pub status: String,
    /// Puntaje 0-100 (100 = trayectoria perfecta)
    pub score: u32,
    /// Etiqueta cualitativa: "Excellent", "Good", "Fair", "Poor", "Invalid"
    pub grade: String,
    /// Mensaje textual resumido.
    pub message: String,
}

impl SummaryDto {
    /// Construye un resumen a partir de findings y métricas.
    pub fn from_analysis(findings: &[Finding], has_collisions: bool, avg_manipulability: Option<f64>, singular_count: usize) -> Self {
        let has_error = findings.iter().any(|f| f.severity == Severity::Error);
        let has_warning = findings.iter().any(|f| f.severity == Severity::Warning);

        let status = if has_error {
            "error"
        } else if has_warning {
            "warning"
        } else {
            "ok"
        };

        // Score 0-100: penaliza por errores y warnings
        let mut score = 100u32;
        if has_collisions { score = score.saturating_sub(40); }
        if singular_count > 0 { score = score.saturating_sub(20 * singular_count as u32).saturating_sub(0); }
        if let Some(avg) = avg_manipulability {
            if avg < 0.3 { score = score.saturating_sub(15); }
            else if avg < 0.5 { score = score.saturating_sub(5); }
        }
        if has_error { score = score.saturating_sub(10); }
        if has_warning { score = score.saturating_sub(5); }

        let grade = if score >= 90 {
            "Excellent"
        } else if score >= 70 {
            "Good"
        } else if score >= 50 {
            "Fair"
        } else if score >= 25 {
            "Poor"
        } else {
            "Invalid"
        };

        let message = match status {
            "error" => "Issues found that prevent safe execution.".to_string(),
            "warning" => "Trajectory is valid but has room for improvement.".to_string(),
            _ => "Trajectory is valid. No issues detected.".to_string(),
        };

        Self { status: status.to_string(), score, grade: grade.to_string(), message }
    }
}

/// Métricas agregadas de la trayectoria.
#[derive(Debug, Serialize)]
pub struct MetricsDto {
    /// Duración total estimada (segundos).
    pub duration: f64,
    /// Cantidad de waypoints analizados.
    pub waypoint_count: usize,
    /// Manipulabilidad promedio (Yoshikawa).
    pub average_manipulability: Option<f64>,
    /// Cantidad de waypoints cerca de singularidad.
    pub near_singular_count: usize,
    /// Cantidad de waypoints singulares.
    pub singular_count: usize,
    /// Distancia mínima a obstáculos (metros, negativo = colisión).
    pub min_collision_distance: Option<f64>,
    /// Indica si hay colisiones en la trayectoria.
    pub has_collisions: bool,
}

/// Hallazgo objetivo del análisis.
#[derive(Debug, Serialize)]
pub struct FindingDto {
    /// Tipo de hallazgo.
    pub kind: String,
    /// Severidad: info, warning, error.
    pub severity: String,
    /// Waypoint donde ocurre (opcional).
    pub waypoint: Option<usize>,
    /// Descripción legible.
    pub message: String,
    /// Valor numérico asociado (opcional).
    pub value: Option<f64>,
}

/// Recomendación accionable.
#[derive(Debug, Serialize)]
pub struct RecommendationDto {
    /// Tipo de recomendación.
    pub kind: String,
    /// Mensaje accionable.
    pub message: String,
    /// Impacto: low, medium, high.
    pub impact: String,
    /// Waypoint asociado (opcional).
    pub waypoint: Option<usize>,
}

// ─── Conversions ───────────────────────────────────────────────────

impl From<&Finding> for FindingDto {
    fn from(f: &Finding) -> Self {
        Self {
            kind: f.kind.to_string(),
            severity: f.severity.to_string(),
            waypoint: f.waypoint,
            message: f.message.clone(),
            value: f.value,
        }
    }
}

impl From<Recommendation> for RecommendationDto {
    fn from(r: Recommendation) -> Self {
        Self {
            kind: r.kind.to_string(),
            message: r.message,
            impact: r.impact.to_string(),
            waypoint: r.waypoint,
        }
    }
}
