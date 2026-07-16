//! DTOs para el endpoint de análisis de planes.

use serde::{Deserialize, Serialize};
use thalos_core::analysis::constraints::Constraint;
use thalos_planning::advisor::Recommendation;

/// Request para analizar un plan activo.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAnalysisRequest {
    /// IDs de plan activo a analizar (opcional — si no se especifica,
    /// analiza el plan activo del runtime).
    pub plan_id: Option<String>,
}

/// Respuesta del análisis de un plan.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAnalysisResponse {
    /// Duración de la trayectoria (segundos).
    pub trajectory_duration: f64,
    /// Cantidad de waypoints analizados.
    pub waypoint_count: usize,

    // Métricas agregadas
    pub avg_manipulability: Option<f64>,
    pub min_manipulability: Option<f64>,
    pub near_singular_count: usize,
    pub singular_count: usize,
    pub min_collision_distance: Option<f64>,
    pub has_collisions: bool,
    pub constraint_violation_count: usize,

    /// Recomendaciones del Advisor.
    pub recommendations: Vec<RecommendationDto>,
}

/// DTO para una recomendación.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationDto {
    pub kind: String,
    pub message: String,
    pub impact: String,
    pub waypoint: Option<usize>,
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
