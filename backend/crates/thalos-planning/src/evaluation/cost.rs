use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::metrics::{MetricKind, PlanMetrics};

/// Puntaje de un plan — incluye desglose por métrica para explicabilidad.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanScore {
    /// Puntaje total (menor = mejor).
    pub total: f64,
    /// Desglose por métrica para explicar el resultado.
    pub breakdown: HashMap<MetricKind, f64>,
    /// Versión legible de las métricas (para UI).
    pub summary: String,
}

/// Función de costo lineal: `total = ∑ weightᵢ × metric_valueᵢ`.
///
/// Cada métrica se normaliza a un rango [0, 1] antes de aplicar el peso.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostFunction {
    pub weights: HashMap<MetricKind, f64>,
}

impl CostFunction {
    /// Crear con pesos por defecto.
    pub fn defaults() -> Self {
        let weights: HashMap<MetricKind, f64> = MetricKind::all_with_defaults().into_iter().collect();
        Self { weights }
    }

    /// Crear con pesos personalizados.
    pub fn new(weights: HashMap<MetricKind, f64>) -> Self {
        Self { weights }
    }

    /// Evaluar un plan y producir un puntaje.
    pub fn score(&self, metrics: &PlanMetrics) -> PlanScore {
        let mut breakdown = HashMap::new();
        let mut total = 0.0;
        let mut parts: Vec<String> = Vec::new();

        let w = |k: MetricKind| self.weights.get(&k).copied().unwrap_or(0.0);

        // Path length: normalizado por una cota superior arbitraria (10 rad)
        let len_val = (metrics.length / 10.0).min(1.0);
        let len_score = len_val * w(MetricKind::PathLength);
        breakdown.insert(MetricKind::PathLength, len_score);
        total += len_score;
        parts.push(format!("len:{:.2}", len_score));

        // Manipulability: menor manip = mayor costo. Escala: 1 - min_manip (0..1 ideal)
        let manip_val = (1.0 - metrics.manipulability.average.clamp(0.0, 1.0)) * 0.5
            + (1.0 - metrics.manipulability.min.clamp(0.0, 1.0)) * 0.5;
        let manip_score = manip_val * w(MetricKind::Manipulability);
        breakdown.insert(MetricKind::Manipulability, manip_score);
        total += manip_score;
        parts.push(format!("manip:{:.2}", manip_score));

        // Joint margin: menor margen = mayor costo
        let margin_val = (1.0 - metrics.joint_safety.min_margin.clamp(0.0, 1.0))
            + (metrics.joint_safety.violation_count as f64 * 0.2).min(1.0);
        let joint_score = margin_val * w(MetricKind::JointMargin);
        breakdown.insert(MetricKind::JointMargin, joint_score);
        total += joint_score;
        parts.push(format!("joint:{:.2}", joint_score));

        // Collision risk: colisiones directas = costo alto
        let coll_val = if metrics.collision.collision_count > 0 {
            1.0
        } else {
            let near = (metrics.collision.near_miss_count as f64 * 0.3).min(1.0);
            let dist = (1.0 - (metrics.collision.min_distance / 0.1).clamp(0.0, 1.0)) * 0.5;
            near.max(dist)
        };
        let coll_score = coll_val * w(MetricKind::CollisionRisk);
        breakdown.insert(MetricKind::CollisionRisk, coll_score);
        total += coll_score;
        parts.push(format!("coll:{:.2}", coll_score));

        // Smoothness: mayor jerk = mayor costo. Normalizado arbitrariamente.
        let smooth_val = (metrics.smoothness / 5.0).min(1.0);
        let smooth_score = smooth_val * w(MetricKind::Smoothness);
        breakdown.insert(MetricKind::Smoothness, smooth_score);
        total += smooth_score;
        parts.push(format!("sm:{:.2}", smooth_score));

        // Orientation change
        let orient_val = (metrics.orientation_change / std::f64::consts::PI).min(1.0);
        let orient_score = orient_val * w(MetricKind::OrientationChange);
        breakdown.insert(MetricKind::OrientationChange, orient_score);
        total += orient_score;
        parts.push(format!("orient:{:.2}", orient_score));

        PlanScore {
            total,
            breakdown,
            summary: parts.join(" "),
        }
    }
}
