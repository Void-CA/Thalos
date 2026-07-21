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
    analysis::{AnalysisSeverity, WaypointAnalysis},
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
    /// Análisis por punto de la trayectoria (para colorear visualización).
    pub waypoints: Vec<WaypointAnalysisDto>,
    /// Hallazgos objetivos detectados.
    pub findings: Vec<FindingDto>,
    /// Recomendaciones accionables.
    pub recommendations: Vec<RecommendationDto>,
    /// Regiones problemáticas semánticas (M8.1+).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problem_regions: Vec<ProblemRegionDto>,
    /// Puntaje de salud general (0.0..1.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_score: Option<f64>,
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

/// Métricas de una región problemática.
#[derive(Debug, Serialize)]
pub struct RegionMetricsDto {
    pub waypoint_count: usize,
    pub average_value: Option<f64>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub error_count: usize,
    pub warning_count: usize,
}

/// Explicación de una región problemática.
#[derive(Debug, Serialize)]
pub struct ExplanationDto {
    pub cause: String,
    pub consequence: String,
    pub recommended_strategies: Vec<String>,
    pub confidence: f64,
}

/// Región problemática semántica (M8.1+).
#[derive(Debug, Serialize)]
pub struct ProblemRegionDto {
    pub id: usize,
    pub kind: String,
    pub severity: String,
    pub waypoint_start: usize,
    pub waypoint_end: usize,
    pub waypoint_count: usize,
    pub metrics: Option<RegionMetricsDto>,
    pub explanation: ExplanationDto,
    pub confidence: Option<f64>,
    pub recommended_strategies: Vec<String>,
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

/// Análisis de un punto individual de la trayectoria para visualización.
#[derive(Debug, Serialize)]
pub struct WaypointAnalysisDto {
    /// Índice del punto en la trayectoria.
    pub index: usize,
    /// Severidad resumida para coloreado ("good", "warning", "critical").
    pub severity: String,
    /// Manipulabilidad de Yoshikawa (opcional).
    pub manipulability: Option<f64>,
    /// Estado de singularidad: "normal", "near", "singular" o null.
    pub singularity_state: Option<String>,
    /// Distancia mínima a obstáculos en metros (negativo = colisión).
    pub clearance: Option<f64>,
}

impl From<&WaypointAnalysis> for WaypointAnalysisDto {
    fn from(wp: &WaypointAnalysis) -> Self {
        let severity = match wp.severity() {
            AnalysisSeverity::Good => "good",
            AnalysisSeverity::Warning => "warning",
            AnalysisSeverity::Critical => "critical",
        };

        let singularity_state = wp.singularity.as_ref().map(|s| {
            if s.condition_number > 200.0 { "singular" }
            else if s.condition_number > 50.0 { "near" }
            else { "normal" }
        });

        Self {
            index: wp.index,
            severity: severity.to_string(),
            manipulability: wp.manipulability.map(|m| m.yoshikawa),
            singularity_state: singularity_state.map(|s| s.to_string()),
            clearance: wp.min_collision_distance,
        }
    }
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
