//! Generación de recomendaciones a partir de hallazgos.
//!
//! El [`PlanAdvisor`] toma los [`Finding`](crate::finding::Finding) producidos por el
//! [`TrajectoryAnalyzer`](crate::analysis::TrajectoryAnalyzer) y los transforma en
//! [`Recommendation`] accionables.
//!
//! **Principio**: El Advisor NUNCA recalcula. Solo interpreta hallazgos.
//! No vuelve a preguntar al Jacobiano, no vuelve a consultar colisiones.
//! No llama a FK. No llama a SVD.
//!
//! Si necesita más datos, el Analyzer debe producirlos como Findings.

use std::fmt;

use crate::finding::{Finding, FindingKind, Severity};

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

/// Una recomendación generada a partir de un hallazgo.
#[derive(Debug, Clone)]
pub struct Recommendation {
    pub kind: SuggestionKind,
    pub message: String,
    pub impact: Impact,
    pub waypoint: Option<usize>,
}

/// Generador de recomendaciones.
///
/// Toma `Vec<Finding>` y produce `Vec<Recommendation>`.
/// No hace ningún cálculo — solo aplica reglas de transformación.
pub struct PlanAdvisor;

impl PlanAdvisor {
    /// Transforma hallazgos en recomendaciones accionables.
    ///
    /// Cada finding puede producir 0, 1 o varias recomendaciones.
    /// Las reglas son secuenciales y determinísticas.
    pub fn advise(&self, findings: &[Finding]) -> Vec<Recommendation> {
        let mut recommendations = Vec::new();

        for finding in findings {
            recommendations.extend(self.transform(finding));
        }

        recommendations
    }

    fn transform(&self, finding: &Finding) -> Vec<Recommendation> {
        match finding.kind {
            FindingKind::LowManipulability => {
                vec![
                    Recommendation {
                        kind: SuggestionKind::Manipulability,
                        message: format!(
                            "Low manipulability ({:.3}). Switching to an alternative IK solver may improve it.",
                            finding.value.unwrap_or(0.0),
                        ),
                        impact: Impact::High,
                        waypoint: finding.waypoint,
                    },
                    Recommendation {
                        kind: SuggestionKind::Waypoint,
                        message: "Add an intermediate waypoint in the low-manipulability region.".to_string(),
                        impact: Impact::Medium,
                        waypoint: finding.waypoint,
                    },
                ]
            }

            FindingKind::NearSingularity => {
                vec![
                    Recommendation {
                        kind: SuggestionKind::Singularity,
                        message: format!(
                            "Cerca de singularidad (condition number: {:.1}). Reducir velocidad o ajustar configuración.",
                            finding.value.unwrap_or(0.0),
                        ),
                        impact: Impact::High,
                        waypoint: finding.waypoint,
                    },
                    Recommendation {
                        kind: SuggestionKind::Velocity,
                        message: "Reducir velocidad máxima evita problemas near-singular.".to_string(),
                        impact: Impact::Medium,
                        waypoint: finding.waypoint,
                    },
                ]
            }

            FindingKind::Singularity => {
                vec![Recommendation {
                    kind: SuggestionKind::Singularity,
                    message: format!(
                        "Singularity at waypoint {}. The trajectory cannot be executed at this point.",
                        finding.waypoint.map(|i| i.to_string()).unwrap_or_default(),
                    ),
                    impact: Impact::High,
                    waypoint: finding.waypoint,
                }]
            }

            FindingKind::Collision => {
                vec![Recommendation {
                    kind: SuggestionKind::Collision,
                    message: format!(
                        "Colisión detectada en waypoint {}. La trayectoria no es segura.",
                        finding.waypoint.map(|i| i.to_string()).unwrap_or_default(),
                    ),
                    impact: Impact::High,
                    waypoint: finding.waypoint,
                }]
            }

            FindingKind::CollisionNear => {
                vec![Recommendation {
                    kind: SuggestionKind::Collision,
                    message: format!(
                        "Obstacle distance low ({:.1} mm). Reduce speed or add intermediate waypoint.",
                        finding.value.unwrap_or(0.0) * 1000.0,
                    ),
                    impact: Impact::Medium,
                    waypoint: finding.waypoint,
                }]
            }

            FindingKind::ConstraintViolation => {
                vec![Recommendation {
                    kind: SuggestionKind::Constraint,
                    message: finding.message.clone(),
                    impact: Impact::High,
                    waypoint: finding.waypoint,
                }]
            }

            FindingKind::IkSuggestion => {
                vec![Recommendation {
                    kind: SuggestionKind::IkSolution,
                    message: finding.message.clone(),
                    impact: Impact::Medium,
                    waypoint: finding.waypoint,
                }]
            }

            // Los hallazgos de ejecución los genera ExecutionAnalyzer, no PlanAdvisor.
            // Se incluyen aquí para exhaustividad del match.
            FindingKind::TrackingError | FindingKind::TrackingSpike => {
                vec![Recommendation {
                    kind: SuggestionKind::Constraint,
                    message: finding.message.clone(),
                    impact: Impact::High,
                    waypoint: finding.waypoint,
                }]
            }
            FindingKind::JointDeviation | FindingKind::VelocityDeviation => {
                vec![Recommendation {
                    kind: SuggestionKind::Constraint,
                    message: finding.message.clone(),
                    impact: Impact::Medium,
                    waypoint: finding.waypoint,
                }]
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finding::{Finding, FindingKind, Severity};

    #[test]
    fn no_recommendations_for_empty_findings() {
        let advisor = PlanAdvisor;
        let recs = advisor.advise(&[]);
        assert!(recs.is_empty());
    }

    #[test]
    fn low_manipulability_produces_two_recommendations() {
        let findings = vec![Finding {
            kind: FindingKind::LowManipulability,
            severity: Severity::Warning,
            waypoint: Some(3),
            message: "low manipulability".into(),
            value: Some(0.15),
            threshold: Some(0.3),
        }];
        let advisor = PlanAdvisor;
        let recs = advisor.advise(&findings);
        assert_eq!(recs.len(), 2);
        assert!(recs.iter().any(|r| r.kind == SuggestionKind::Manipulability));
        assert!(recs.iter().any(|r| r.kind == SuggestionKind::Waypoint));
    }

    #[test]
    fn collision_finding_produces_one_recommendation() {
        let findings = vec![Finding {
            kind: FindingKind::Collision,
            severity: Severity::Error,
            waypoint: Some(5),
            message: "colisión".into(),
            value: Some(-0.01),
            threshold: Some(0.0),
        }];
        let advisor = PlanAdvisor;
        let recs = advisor.advise(&findings);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].kind, SuggestionKind::Collision);
        assert_eq!(recs[0].impact, Impact::High);
    }
}
