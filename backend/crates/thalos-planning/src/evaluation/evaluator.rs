use thalos_core::trajectory::Trajectory;

use crate::analysis::WaypointAnalysis;
use crate::evaluation::PlanScore;
use crate::evaluation::cost::CostFunction;
use crate::evaluation::metrics::{
    CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics, PlanMetrics,
};

/// Convierte análisis de waypoints en métricas agregadas y puntajes.
///
/// Stateless — toda la configuración está en `CostFunction`.
pub struct PlanEvaluator;

impl PlanEvaluator {
    /// Agregar un conjunto de `WaypointAnalysis` en `PlanMetrics`.
    pub fn compute_metrics(waypoints: &[WaypointAnalysis]) -> PlanMetrics {
        if waypoints.is_empty() {
            return PlanMetrics {
                length: 0.0,
                waypoint_count: 0,
                manipulability: ManipulabilityMetrics::new(0.0, 0.0, 0, 0),
                joint_safety: JointSafetyMetrics::new(1.0, 0.0, 0),
                collision: CollisionMetrics::new(f64::MAX, 0, 0),
                smoothness: 0.0,
                orientation_change: 0.0,
            };
        }

        // ── Longitud ──
        let length: f64 = waypoints
            .windows(2)
            .map(|w| {
                w[1].joints
                    .iter()
                    .zip(&w[0].joints)
                    .map(|(a, b)| (a - b).powi(2))
                    .sum::<f64>()
                    .sqrt()
            })
            .sum();

        // ── Manipulabilidad ──
        let yoshi_vals: Vec<f64> = waypoints
            .iter()
            .filter_map(|w| w.manipulability.as_ref().map(|m| m.yoshikawa))
            .collect();

        let (min_manip, avg_manip) = if yoshi_vals.is_empty() {
            (0.0, 0.0)
        } else {
            let min = yoshi_vals.iter().cloned().fold(f64::MAX, f64::min);
            let avg = yoshi_vals.iter().sum::<f64>() / yoshi_vals.len() as f64;
            (min, avg)
        };

        let near_singular_count = waypoints
            .iter()
            .filter(|w| {
                w.singularity
                    .as_ref()
                    .is_some_and(|s| s.condition_number > 100.0 && s.condition_number < 1000.0)
            })
            .count();

        let singular_count = waypoints
            .iter()
            .filter(|w| {
                w.singularity
                    .as_ref()
                    .is_some_and(|s| s.condition_number >= 1000.0)
            })
            .count();

        // ── Seguridad articular ──
        // Asumimos límites [-π, π] por defecto. En el futuro se obtendrán del modelo.
        let joint_margins: Vec<Vec<f64>> = waypoints
            .iter()
            .map(|w| {
                w.joints
                    .iter()
                    .map(|&q| {
                        let range = std::f64::consts::PI;
                        1.0 - (q.abs() / range).clamp(0.0, 1.0)
                    })
                    .collect()
            })
            .collect();

        let min_margin = joint_margins
            .iter()
            .flatten()
            .cloned()
            .fold(f64::MAX, f64::min);

        let avg_max_utilization = if joint_margins.is_empty() {
            0.0
        } else {
            let total_max: f64 = joint_margins
                .iter()
                .map(|margins| margins.iter().cloned().fold(f64::MAX, f64::min))
                .map(|m| 1.0 - m)
                .sum();
            total_max / joint_margins.len() as f64
        };

        let violation_count = waypoints
            .iter()
            .filter(|w| {
                w.joints
                    .iter()
                    .any(|&q| q.abs() > std::f64::consts::PI - 0.01)
            })
            .count();

        // ── Colisiones ──
        let min_coll_dist = waypoints
            .iter()
            .filter_map(|w| w.min_collision_distance)
            .fold(f64::MAX, f64::min);

        let collision_count = waypoints
            .iter()
            .filter(|w| w.min_collision_distance.is_some_and(|d| d < 0.0))
            .count();

        let near_miss_count = waypoints
            .iter()
            .filter(|w| {
                w.min_collision_distance
                    .is_some_and(|d| d >= 0.0 && d < 0.05)
            })
            .count();

        // ── Suavidad (jerk acumulado entre waypoints consecutivos) ──
        let smoothness = if waypoints.len() >= 3 {
            waypoints
                .windows(3)
                .map(|w| {
                    let dt = (w[2].timestamp - w[0].timestamp).max(1e-6);
                    let jerk: f64 = w[2]
                        .joints
                        .iter()
                        .zip(&w[1].joints)
                        .zip(&w[0].joints)
                        .map(|((c, b), a)| ((c - 2.0 * b + a) / dt).powi(2))
                        .sum::<f64>()
                        .sqrt();
                    jerk
                })
                .sum::<f64>()
                / (waypoints.len() - 2) as f64
        } else {
            0.0
        };

        // ── Cambio de orientación ──
        // Estimado como suma de diferencias angulares entre waypoints consecutivos.
        // En el futuro se obtendrá del FK real.
        let orientation_change: f64 = waypoints
            .windows(2)
            .map(|w| {
                w[1].joints
                    .iter()
                    .zip(&w[0].joints)
                    .map(|(a, b)| (a - b).abs())
                    .sum::<f64>()
                    * 0.1 // factor de escala arbitrario
            })
            .sum();

        PlanMetrics {
            length,
            waypoint_count: waypoints.len(),
            manipulability: ManipulabilityMetrics::new(
                min_manip,
                avg_manip,
                near_singular_count,
                singular_count,
            ),
            joint_safety: JointSafetyMetrics::new(min_margin, avg_max_utilization, violation_count),
            collision: CollisionMetrics::new(min_coll_dist, collision_count, near_miss_count),
            smoothness,
            orientation_change,
        }
    }

    /// Computar métricas directamente desde una trayectoria (sin análisis completo).
    ///
    /// Útil para evaluar candidatos de reparación (M8.2).
    /// No produce análisis de manipulabilidad, singularidad ni colisiones.
    pub fn compute_metrics_from_joints(trajectory: &Trajectory) -> PlanMetrics {
        let wps = trajectory.waypoints();
        if wps.is_empty() {
            return PlanMetrics {
                length: 0.0,
                waypoint_count: 0,
                manipulability: crate::evaluation::metrics::ManipulabilityMetrics::new(
                    0.0, 0.0, 0, 0,
                ),
                joint_safety: crate::evaluation::metrics::JointSafetyMetrics::new(1.0, 0.0, 0),
                collision: crate::evaluation::metrics::CollisionMetrics::new(f64::MAX, 0, 0),
                smoothness: 0.0,
                orientation_change: 0.0,
            };
        }

        // Length
        let length: f64 = wps
            .windows(2)
            .map(|w| {
                w[1].joints()
                    .iter()
                    .zip(w[0].joints())
                    .map(|(a, b)| (a - b).powi(2))
                    .sum::<f64>()
                    .sqrt()
            })
            .sum();

        // Joint safety (no manipulability data without analysis)
        let min_margin = wps
            .iter()
            .flat_map(|wp| {
                wp.joints().iter().map(|&q| {
                    let range = std::f64::consts::PI;
                    1.0 - (q.abs() / range).clamp(0.0, 1.0)
                })
            })
            .fold(f64::MAX, f64::min);

        let avg_util = {
            let total_max: f64 = wps
                .iter()
                .map(|wp| {
                    wp.joints()
                        .iter()
                        .map(|&q| (q.abs() / std::f64::consts::PI).clamp(0.0, 1.0))
                        .fold(0.0f64, f64::max)
                })
                .sum();
            total_max / wps.len() as f64
        };

        let violation_count = wps
            .iter()
            .filter(|wp| {
                wp.joints()
                    .iter()
                    .any(|&q| q.abs() > std::f64::consts::PI - 0.01)
            })
            .count();

        // Smoothness
        let smoothness = if wps.len() >= 3 {
            wps.windows(3)
                .map(|w| {
                    let dt = (w[2].timestamp() - w[0].timestamp()).max(1e-6);
                    let jerk: f64 = w[2]
                        .joints()
                        .iter()
                        .zip(w[1].joints())
                        .zip(w[0].joints())
                        .map(|((c, b), a)| ((c - 2.0 * b + a) / dt).powi(2))
                        .sum::<f64>()
                        .sqrt();
                    jerk
                })
                .sum::<f64>()
                / (wps.len() - 2) as f64
        } else {
            0.0
        };

        // Orientation change (estimated from joint deltas)
        let orientation_change: f64 = wps
            .windows(2)
            .map(|w| {
                w[1].joints()
                    .iter()
                    .zip(w[0].joints())
                    .map(|(a, b)| (a - b).abs())
                    .sum::<f64>()
                    * 0.1
            })
            .sum();

        PlanMetrics {
            length,
            waypoint_count: wps.len(),
            manipulability: crate::evaluation::metrics::ManipulabilityMetrics::new(0.0, 0.0, 0, 0),
            joint_safety: crate::evaluation::metrics::JointSafetyMetrics::new(
                min_margin,
                avg_util,
                violation_count,
            ),
            collision: crate::evaluation::metrics::CollisionMetrics::new(f64::MAX, 0, 0),
            smoothness,
            orientation_change,
        }
    }

    /// Evaluar un conjunto de waypoints y producir un puntaje.
    pub fn evaluate(waypoints: &[WaypointAnalysis], cost_function: &CostFunction) -> PlanScore {
        let metrics = Self::compute_metrics(waypoints);
        cost_function.score(&metrics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::WaypointAnalysis;
    use thalos_core::kinematics::jacobian::{
        manipulability::ManipulabilityReport, singularity::SingularityReport,
    };

    fn sample_waypoints() -> Vec<WaypointAnalysis> {
        vec![
            WaypointAnalysis {
                index: 0,
                timestamp: 0.0,
                joints: vec![0.0, 0.0],
                singularity: Some(SingularityReport {
                    det_jtj: 1.0,
                    condition_number: 2.0,
                    rank: 2,
                    singular_values: vec![1.0, 0.5],
                }),
                manipulability: Some(ManipulabilityReport {
                    yoshikawa: 0.5,
                    isotropy: 0.5,
                }),
                min_collision_distance: Some(0.1),
            },
            WaypointAnalysis {
                index: 1,
                timestamp: 1.0,
                joints: vec![0.5, 0.3],
                singularity: Some(SingularityReport {
                    det_jtj: 0.5,
                    condition_number: 10.0,
                    rank: 2,
                    singular_values: vec![1.0, 0.5],
                }),
                manipulability: Some(ManipulabilityReport {
                    yoshikawa: 0.5,
                    isotropy: 0.5,
                }),
                min_collision_distance: Some(0.08),
            },
        ]
    }

    #[test]
    fn compute_metrics_with_sample_waypoints() {
        let wps = sample_waypoints();
        let metrics = PlanEvaluator::compute_metrics(&wps);

        assert!(metrics.length > 0.0);
        assert_eq!(metrics.waypoint_count, 2);
        assert!((metrics.manipulability.average - 0.5).abs() < 1e-6);
        assert!((metrics.manipulability.min - 0.5).abs() < 1e-6);
        assert_eq!(metrics.joint_safety.violation_count, 0);
        assert_eq!(metrics.collision.collision_count, 0);
    }

    #[test]
    fn empty_waypoints_return_defaults() {
        let metrics = PlanEvaluator::compute_metrics(&[]);
        assert_eq!(metrics.waypoint_count, 0);
        assert_eq!(metrics.length, 0.0);
    }

    #[test]
    fn cost_function_default_weights() {
        let wps = sample_waypoints();
        let cost = CostFunction::defaults();
        let score = PlanEvaluator::evaluate(&wps, &cost);

        assert!(score.total > 0.0);
        assert!(!score.breakdown.is_empty());
        assert!(!score.summary.is_empty());
    }

    #[test]
    fn cost_function_custom_weights() {
        use crate::evaluation::metrics::MetricKind;
        use std::collections::HashMap;
        let wps = sample_waypoints();
        let mut weights = HashMap::new();
        weights.insert(MetricKind::PathLength, 1.0);
        weights.insert(MetricKind::Manipulability, 0.0);
        let cost = CostFunction::new(weights);
        let score = PlanEvaluator::evaluate(&wps, &cost);

        // manipulability weight is 0, so manip score must be 0
        assert!((score.breakdown.get(&MetricKind::Manipulability).unwrap() - 0.0).abs() < 1e-6);
    }
}
