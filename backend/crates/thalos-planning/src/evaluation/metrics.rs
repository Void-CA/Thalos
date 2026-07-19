use serde::{Deserialize, Serialize};

/// Métricas cuantificables de un plan — independientes de cómo se obtuvieron.
///
/// Pueden provenir de `WaypointAnalysis` (plan analizado), de un `MotionTrace`
/// (ejecución real), o de una simulación física futura.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanMetrics {
    /// Longitud total del camino en espacio articular (suma de distancias euclidianas).
    pub length: f64,
    /// Número de waypoints.
    pub waypoint_count: usize,
    /// Métricas de manipulabilidad.
    pub manipulability: ManipulabilityMetrics,
    /// Métricas de seguridad articular.
    pub joint_safety: JointSafetyMetrics,
    /// Métricas de colisión.
    pub collision: CollisionMetrics,
    /// Suavidad de la trayectoria (promedio de jerk entre waypoints consecutivos).
    /// Menor = más suave.
    pub smoothness: f64,
    /// Cambio total de orientación del TCP (radianes).
    pub orientation_change: f64,
}

impl PlanMetrics {
    /// Crear métricas desde valores ya computados.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        length: f64,
        waypoint_count: usize,
        manipulability: ManipulabilityMetrics,
        joint_safety: JointSafetyMetrics,
        collision: CollisionMetrics,
        smoothness: f64,
        orientation_change: f64,
    ) -> Self {
        Self {
            length,
            waypoint_count,
            manipulability,
            joint_safety,
            collision,
            smoothness,
            orientation_change,
        }
    }
}

/// Métricas de manipulabilidad a lo largo de la trayectoria.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManipulabilityMetrics {
    /// Valor mínimo de Yoshikawa en cualquier waypoint.
    pub min: f64,
    /// Valor promedio de Yoshikawa.
    pub average: f64,
    /// Cantidad de waypoints en o cerca de singularidad.
    pub near_singular_count: usize,
    /// Cantidad de waypoints en singularidad.
    pub singular_count: usize,
}

impl ManipulabilityMetrics {
    pub fn new(min: f64, average: f64, near_singular_count: usize, singular_count: usize) -> Self {
        Self {
            min,
            average,
            near_singular_count,
            singular_count,
        }
    }
}

/// Métricas de seguridad respecto a límites articulares.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JointSafetyMetrics {
    /// Margen mínimo a cualquier límite articular (fracción 0.0–1.0).
    /// 1.0 = en el centro del rango, 0.0 = en el límite.
    pub min_margin: f64,
    /// Promedio de la peor utilización por waypoint.
    pub avg_max_utilization: f64,
    /// Cantidad de violaciones de límites.
    pub violation_count: usize,
}

impl JointSafetyMetrics {
    pub fn new(min_margin: f64, avg_max_utilization: f64, violation_count: usize) -> Self {
        Self {
            min_margin,
            avg_max_utilization,
            violation_count,
        }
    }
}

/// Métricas de colisión.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollisionMetrics {
    /// Distancia mínima a obstáculos (negativo = colisión).
    pub min_distance: f64,
    /// Cantidad de waypoints en colisión.
    pub collision_count: usize,
    /// Cantidad de waypoints cerca de colisión.
    pub near_miss_count: usize,
}

impl CollisionMetrics {
    pub fn new(min_distance: f64, collision_count: usize, near_miss_count: usize) -> Self {
        Self {
            min_distance,
            collision_count,
            near_miss_count,
        }
    }
}

/// Identificador de una métrica — usado como clave en `CostFunction.weights`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MetricKind {
    /// Ponderación de la longitud del camino.
    PathLength,
    /// Ponderación de la manipulabilidad (negativa: mayor manipulabilidad = menor costo).
    Manipulability,
    /// Ponderación del margen a límites articulares.
    JointMargin,
    /// Ponderación del riesgo de colisión.
    CollisionRisk,
    /// Ponderación de la suavidad.
    Smoothness,
    /// Ponderación del cambio de orientación.
    OrientationChange,
}

impl MetricKind {
    /// Valor por defecto para cada métrica.
    pub fn default_weight(&self) -> f64 {
        match self {
            MetricKind::PathLength => 0.3,
            MetricKind::Manipulability => 1.0,
            MetricKind::JointMargin => 0.5,
            MetricKind::CollisionRisk => 2.0,
            MetricKind::Smoothness => 0.4,
            MetricKind::OrientationChange => 0.2,
        }
    }

    /// Retorna todos los kinds con sus pesos por defecto.
    pub fn all_with_defaults() -> Vec<(Self, f64)> {
        vec![
            (Self::PathLength, 0.3),
            (Self::Manipulability, 1.0),
            (Self::JointMargin, 0.5),
            (Self::CollisionRisk, 2.0),
            (Self::Smoothness, 0.4),
            (Self::OrientationChange, 0.2),
        ]
    }
}
