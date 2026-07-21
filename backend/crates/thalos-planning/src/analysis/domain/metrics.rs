use serde::{Deserialize, Serialize};
use thalos_math::Transform3D;

/// Métricas agregadas de una región problemática.
///
/// # Invariantes
/// - Debe ser agregable (fusionable entre regiones adyacentes del mismo tipo)
/// - Debe ser serializable
/// - No depende del frontend
/// - No contiene referencias al plan o trayectoria
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionMetrics {
    /// Cantidad de waypoints en la región.
    pub waypoint_count: usize,
    /// Valor promedio de la métrica afectada (manipulabilidad, distancia, etc.)
    pub average_value: Option<f64>,
    /// Valor mínimo observado.
    pub min_value: Option<f64>,
    /// Valor máximo observado.
    pub max_value: Option<f64>,
    /// Cantidad de findings de tipo error en esta región.
    pub error_count: usize,
    /// Cantidad de findings de tipo warning.
    pub warning_count: usize,
}

impl RegionMetrics {
    /// Fusiona dos métricas de regiones adyacentes del mismo tipo.
    pub fn merge(&self, other: &Self) -> Self {
        let total = self.waypoint_count + other.waypoint_count;
        let weighted_avg = |a: f64, b: f64, a_cnt: usize, b_cnt: usize| -> f64 {
            (a * a_cnt as f64 + b * b_cnt as f64) / total as f64
        };
        Self {
            waypoint_count: total,
            average_value: match (self.average_value, other.average_value) {
                (Some(a), Some(b)) => Some(weighted_avg(a, b, self.waypoint_count, other.waypoint_count)),
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                (None, None) => None,
            },
            min_value: match (self.min_value, other.min_value) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                (None, None) => None,
            },
            max_value: match (self.max_value, other.max_value) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                (None, None) => None,
            },
            error_count: self.error_count + other.error_count,
            warning_count: self.warning_count + other.warning_count,
        }
    }
}

/// Límites de entrada y salida de una región problemática.
#[derive(Debug, Clone)]
pub struct RegionBoundary {
    /// Pose en el waypoint anterior al inicio de la región (None si es el inicio de la trayectoria).
    pub entry_pose: Option<Transform3D>,
    /// Pose en el waypoint posterior al final de la región (None si es el final de la trayectoria).
    pub exit_pose: Option<Transform3D>,
}
