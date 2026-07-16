//! Generación de recomendaciones a partir del análisis de trayectorias.
//!
//! El [[`PlanAdvisor`]] toma un [`PlanAnalysis`] y produce sugerencias
//! accionables para el usuario, clasificadas por tipo e impacto.

use std::fmt;

use crate::analysis::{PlanAnalysis, WaypointAnalysis};

/// Tipo de recomendación.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SuggestionKind {
    IkSolution,
    Velocity,
    Waypoint,
    Collision,
    Singularity,
    Manipulability,
    Constraint,
}

impl fmt::Display for SuggestionKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SuggestionKind::IkSolution => write!(f, "ik_solution"),
            SuggestionKind::Velocity => write!(f, "velocity"),
            SuggestionKind::Waypoint => write!(f, "waypoint"),
            SuggestionKind::Collision => write!(f, "collision"),
            SuggestionKind::Singularity => write!(f, "singularity"),
            SuggestionKind::Manipulability => write!(f, "manipulability"),
            SuggestionKind::Constraint => write!(f, "constraint"),
        }
    }
}

/// Nivel de impacto de una recomendación.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Impact {
    Low,
    Medium,
    High,
}

impl fmt::Display for Impact {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Impact::Low => write!(f, "low"),
            Impact::Medium => write!(f, "medium"),
            Impact::High => write!(f, "high"),
        }
    }
}

/// Una recomendación generada por el Advisor.
#[derive(Debug, Clone)]
pub struct Recommendation {
    pub kind: SuggestionKind,
    pub message: String,
    pub impact: Impact,
    pub waypoint: Option<usize>,
}

/// Generador de recomendaciones a partir del análisis de trayectorias.
///
/// Examina las métricas del análisis y produce sugerencias cuando
/// detecta valores sub-óptimos o problemas.
///
/// # Ejemplo
///
/// ```ignore
/// let advisor = PlanAdvisor::default();
/// let suggestions = advisor.advise(&analysis);
/// for s in &suggestions {
///     println!("[{:?}] {} (impacto: {})", s.kind, s.message, s.impact);
/// }
/// ```
pub struct PlanAdvisor {
    /// Umbral de manipulabilidad mínima para generar warning.
    pub manipulability_threshold: f64,
    /// Umbral de distancia a obstáculos (metros) para generar warning.
    pub collision_distance_threshold: f64,
    /// Umbral de condition number para near-singular.
    pub near_singular_threshold: f64,
}

impl Default for PlanAdvisor {
    fn default() -> Self {
        Self {
            manipulability_threshold: 0.3,
            collision_distance_threshold: 0.05,
            near_singular_threshold: 100.0,
        }
    }
}

impl PlanAdvisor {
    pub fn new(
        manipulability_threshold: f64,
        collision_distance_threshold: f64,
        near_singular_threshold: f64,
    ) -> Self {
        Self {
            manipulability_threshold,
            collision_distance_threshold,
            near_singular_threshold,
        }
    }

    /// Genera recomendaciones basadas en el análisis de la trayectoria.
    pub fn advise(&self, analysis: &PlanAnalysis) -> Vec<Recommendation> {
        let mut suggestions = Vec::new();

        suggestions.extend(self.assess_manipulability(analysis));
        suggestions.extend(self.assess_singularities(analysis));
        suggestions.extend(self.assess_collisions(analysis));
        suggestions.extend(self.assess_constraints(analysis));

        suggestions
    }

    fn assess_manipulability(&self, analysis: &PlanAnalysis) -> Vec<Recommendation> {
        let mut suggestions = Vec::new();

        if let Some(avg) = analysis.metrics.avg_manipulability {
            if avg < self.manipulability_threshold {
                suggestions.push(Recommendation {
                    kind: SuggestionKind::Manipulability,
                    message: format!(
                        "Manipulabilidad promedio baja ({:.3}). Cambiar solución IK o ajustar configuración inicial.",
                        avg,
                    ),
                    impact: Impact::High,
                    waypoint: None,
                });

                // Find the worst waypoint
                if let Some(worst) = analysis.waypoints.iter()
                    .filter_map(|w| w.manipulability.as_ref().map(|m| (w.index, m.yoshikawa)))
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                {
                    suggestions.push(Recommendation {
                        kind: SuggestionKind::Waypoint,
                        message: format!(
                            "Manipulabilidad mínima en waypoint {} ({:.3}). Agregar waypoint intermedio.",
                            worst.0, worst.1,
                        ),
                        impact: Impact::Medium,
                        waypoint: Some(worst.0),
                    });
                }
            }
        }

        suggestions
    }

    fn assess_singularities(&self, analysis: &PlanAnalysis) -> Vec<Recommendation> {
        let mut suggestions = Vec::new();

        if analysis.metrics.near_singular_count > 0 {
            let near_wps: Vec<&WaypointAnalysis> = analysis.waypoints.iter()
                .filter(|w| {
                    w.singularity.as_ref()
                        .map(|s| s.condition_number >= self.near_singular_threshold && s.condition_number < 1000.0)
                        .unwrap_or(false)
                })
                .collect();

            if let Some(wp) = near_wps.first() {
                suggestions.push(Recommendation {
                    kind: SuggestionKind::Singularity,
                    message: format!(
                        "Singularidad cercana en waypoint {} (condition number: {:.1}). Reducir velocidad o ajustar configuración.",
                        wp.index,
                        wp.singularity.as_ref().map(|s| s.condition_number).unwrap_or(0.0),
                    ),
                    impact: Impact::High,
                    waypoint: Some(wp.index),
                });
            }
        }

        if analysis.metrics.singular_count > 0 {
            let sing_wps: Vec<&WaypointAnalysis> = analysis.waypoints.iter()
                .filter(|w| {
                    w.singularity.as_ref()
                        .map(|s| s.condition_number >= 1000.0)
                        .unwrap_or(false)
                })
                .collect();

            if let Some(wp) = sing_wps.first() {
                suggestions.push(Recommendation {
                    kind: SuggestionKind::Singularity,
                    message: format!(
                        "Singularidad detectada en waypoint {} (condition number: {:.1}). La trayectoria no es ejecutable en este punto.",
                        wp.index,
                        wp.singularity.as_ref().map(|s| s.condition_number).unwrap_or(0.0),
                    ),
                    impact: Impact::High,
                    waypoint: Some(wp.index),
                });
            }
        }

        suggestions
    }

    fn assess_collisions(&self, analysis: &PlanAnalysis) -> Vec<Recommendation> {
        let mut suggestions = Vec::new();

        if analysis.metrics.has_collisions {
            suggestions.push(Recommendation {
                kind: SuggestionKind::Collision,
                message: format!(
                    "Colisión detectada en waypoint {}. La trayectoria no es segura.",
                    analysis.metrics.first_collision_waypoint
                        .map(|i| i.to_string())
                        .unwrap_or_else(|| "desconocido".to_string()),
                ),
                impact: Impact::High,
                waypoint: analysis.metrics.first_collision_waypoint,
            });
        } else if let Some(min_dist) = analysis.metrics.min_collision_distance {
            if min_dist < self.collision_distance_threshold {
                suggestions.push(Recommendation {
                    kind: SuggestionKind::Collision,
                    message: format!(
                        "Distancia mínima a obstáculo baja ({:.1} mm en waypoint {}). Reducir velocidad o agregar waypoint intermedio.",
                        min_dist * 1000.0,
                        analysis.metrics.min_collision_waypoint
                            .map(|i| i.to_string())
                            .unwrap_or_else(|| "?".to_string()),
                    ),
                    impact: Impact::Medium,
                    waypoint: analysis.metrics.min_collision_waypoint,
                });
            }
        }

        suggestions
    }

    fn assess_constraints(&self, analysis: &PlanAnalysis) -> Vec<Recommendation> {
        let mut suggestions = Vec::new();

        for violation in &analysis.constraint_violations {
            suggestions.push(Recommendation {
                kind: SuggestionKind::Constraint,
                message: violation.message.clone(),
                impact: Impact::High,
                waypoint: Some(violation.waypoint),
            });
        }

        suggestions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{AnalysisMetrics, PlanAnalysis, WaypointAnalysis};
    use thalos_core::kinematics::jacobian::manipulability::ManipulabilityReport;

    fn make_empty_analysis() -> PlanAnalysis {
        PlanAnalysis {
            waypoints: vec![],
            metrics: AnalysisMetrics {
                waypoint_count: 0,
                trajectory_duration: 0.0,
                avg_manipulability: None,
                min_manipulability: None,
                near_singular_count: 0,
                singular_count: 0,
                min_collision_distance: None,
                min_collision_waypoint: None,
                has_collisions: false,
                first_collision_waypoint: None,
            },
            constraint_violations: vec![],
        }
    }

    #[test]
    fn no_suggestions_for_clean_plan() {
        let analysis = make_empty_analysis();
        let advisor = PlanAdvisor::default();
        let suggestions = advisor.advise(&analysis);
        assert!(suggestions.is_empty());
    }

    #[test]
    fn suggests_when_manipulability_low() {
        let analysis = PlanAnalysis {
            waypoints: vec![
                WaypointAnalysis {
                    index: 0,
                    timestamp: 0.0,
                    joints: vec![0.0, 0.0],
                    singularity: None,
                    manipulability: Some(ManipulabilityReport { yoshikawa: 0.2, isotropy: 0.1 }),
                    min_collision_distance: None,
                },
            ],
            metrics: AnalysisMetrics {
                waypoint_count: 1,
                trajectory_duration: 0.0,
                avg_manipulability: Some(0.2),
                min_manipulability: Some(0.2),
                near_singular_count: 0,
                singular_count: 0,
                min_collision_distance: None,
                min_collision_waypoint: None,
                has_collisions: false,
                first_collision_waypoint: None,
            },
            constraint_violations: vec![],
        };

        let advisor = PlanAdvisor::default();
        let suggestions = advisor.advise(&analysis);
        assert!(suggestions.iter().any(|s| s.kind == SuggestionKind::Manipulability));
    }

    #[test]
    fn suggests_when_collision_too_close() {
        let analysis = PlanAnalysis {
            waypoints: vec![],
            metrics: AnalysisMetrics {
                waypoint_count: 0,
                trajectory_duration: 0.0,
                avg_manipulability: None,
                min_manipulability: None,
                near_singular_count: 0,
                singular_count: 0,
                min_collision_distance: Some(0.02),
                min_collision_waypoint: Some(3),
                has_collisions: false,
                first_collision_waypoint: None,
            },
            constraint_violations: vec![],
        };

        let advisor = PlanAdvisor::default();
        let suggestions = advisor.advise(&analysis);
        assert!(suggestions.iter().any(|s| s.kind == SuggestionKind::Collision));
    }
}
