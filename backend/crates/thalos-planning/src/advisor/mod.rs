//! Generación de recomendaciones a partir de hallazgos.
//!
//! El [`PlanAdvisor`] toma los [`Finding`](crate::finding::Finding) producidos por el
//! [`TrajectoryAnalyzer`](crate::analysis::TrajectoryAnalyzer) y los transforma en
//! [`Recommendation`] accionables (camino legacy) o, desde PR 3, toma
//! [`Observation`](thalos_core::analysis::observation::Observation)s y produce
//! [`Action`](thalos_core::analysis::action::Action)s que las referencian por id (I5).
//!
//! **Principio**: El Advisor NUNCA recalcula. Solo interpreta hallazgos.
//! No vuelve a preguntar al Jacobiano, no vuelve a consultar colisiones.
//! No llama a FK. No llama a SVD.
//!
//! Si necesita más datos, el Analyzer debe producirlos como Findings.

use std::collections::BTreeMap;
use std::fmt;

use thalos_core::analysis::action::{Action, ActionId, ActionImpact, ActionKind, ActionPriority};
use thalos_core::analysis::observation::{Observation, ObservationKind};

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
    /// Transforma observaciones en acciones accionables (PR 3, spec I5).
    ///
    /// Cada [`Action`] referencia la observación que la motivó por id
    /// (`target_observation`), preservando la separación
    /// diagnóstico/remediación (I5) y la trazabilidad de la cadena
    /// `TrajectoryAnalyzer → Observation → PlanAdvisor → Action` (C3).
    ///
    /// Las reglas son 1:1 con las del advisor legacy (SuggestionKind →
    /// ActionKind, Impact → priority/impact). El mensaje textual de la
    /// recomendación se descarta (I1): los renderers reconstruyen la
    /// presentación (cambio A). Fenómenos sin regla de remediación NO
    /// producen acción (C2: el advisor no inventa conocimiento).
    pub fn advise(&self, observations: &[Observation]) -> Vec<Action> {
        let mut actions = Vec::new();
        for observation in observations {
            for &(kind, priority, impact) in Self::remediation(observation.kind) {
                actions.push(Action {
                    id: ActionId(0), // the consumer/aggregator reassigns unique ids
                    kind,
                    target_observation: observation.id,
                    priority,
                    impact,
                    parameters: BTreeMap::new(),
                });
            }
        }
        actions
    }

    /// Reglas de remediación por fenómeno: `kind → [(ActionKind, priority, impact)]`.
    ///
    /// Traducción exacta de las reglas del advisor legacy (SuggestionKind /
    /// Impact), ahora sobre el vocabulario de observaciones. Un fenómeno sin
    /// entrada — o fuera del ámbito plan (ejecución/semántica, PR 4/5) — no
    /// produce acción (C2).
    fn remediation(kind: ObservationKind) -> &'static [(ActionKind, ActionPriority, ActionImpact)] {
        use ActionImpact as I;
        use ActionKind as K;
        use ActionPriority as P;
        match kind {
            ObservationKind::LowManipulability => &[
                (K::Manipulability, P::High, I::High),
                (K::Waypoint, P::Medium, I::Medium),
            ],
            ObservationKind::NearSingularity => &[
                (K::Singularity, P::High, I::High),
                (K::Velocity, P::Medium, I::Medium),
            ],
            ObservationKind::Singularity => &[(K::Singularity, P::High, I::High)],
            ObservationKind::CollisionRisk => &[(K::Collision, P::High, I::High)],
            ObservationKind::CollisionNear => &[(K::Collision, P::Medium, I::Medium)],
            ObservationKind::ConstraintViolation => &[(K::Constraint, P::High, I::High)],
            // Fenómenos de ejecución/semánticos y cualquier fenómeno nuevo
            // (enum `#[non_exhaustive]`) sin regla plan-level: sin acción.
            _ => &[],
        }
    }

    /// Transforma hallazgos legacy en recomendaciones accionables.
    ///
    /// # TODO(analysis-model): remove after phase 7
    ///
    /// Camino legacy mantenido para los DTOs de la API
    /// ([`Recommendation`]) hasta que el wire format migre a
    /// [`Action`] (PR 7a). El camino canónico es [`Self::advise`].
    ///
    /// Cada finding puede producir 0, 1 o varias recomendaciones.
    /// Las reglas son secuenciales y determinísticas.
    pub fn advise_findings(&self, findings: &[Finding]) -> Vec<Recommendation> {
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
                        message: "Add an intermediate waypoint in the low-manipulability region."
                            .to_string(),
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
                        message: "Reducir velocidad máxima evita problemas near-singular."
                            .to_string(),
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

    // ─── PR 3: advisor over the canonical model (task 3.3) ─────────
    //
    // I5: actions live at the report level and reference observations by id.
    // C2: the advisor never discovers facts — it only proposes remediation for
    // observations it already receives.

    fn observation(id: u32, kind: ObservationKind) -> Observation {
        use std::collections::BTreeMap;
        use thalos_core::analysis::location::Location;
        use thalos_core::analysis::observation::{
            ArtifactRef, Observation, ObservationId, Severity,
        };
        use thalos_core::ids::MotionPlanId;
        Observation {
            id: ObservationId(id),
            kind,
            severity: Severity::Warning,
            artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
            location: Location::Waypoint(5),
            attributes: BTreeMap::new(),
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    #[test]
    fn advise_produces_actions_over_observations() {
        use thalos_core::analysis::observation::ObservationKind;
        let observations = vec![
            observation(1, ObservationKind::NearSingularity),
            observation(2, ObservationKind::LowManipulability),
        ];
        let advisor = PlanAdvisor;
        let actions = advisor.advise(&observations);

        // LowManipulability → 2 actions, NearSingularity → 2 actions (the same
        // remediation rules the legacy advisor applied to the findings).
        assert_eq!(actions.len(), 4);

        // I5: EVERY action references an observation id that exists.
        for action in &actions {
            assert!(
                observations
                    .iter()
                    .any(|o| o.id == action.target_observation),
                "action {:?} must target an existing observation",
                action.kind
            );
        }

        // The remediation kinds survive the migration (SuggestionKind → ActionKind).
        assert!(
            actions
                .iter()
                .any(|a| a.kind == thalos_core::analysis::action::ActionKind::Singularity)
        );
        assert!(
            actions
                .iter()
                .any(|a| a.kind == thalos_core::analysis::action::ActionKind::Manipulability)
        );
        // Legacy impact model maps 1:1 onto the action priority/impact.
        assert!(actions.iter().any(|a| {
            a.priority == thalos_core::analysis::action::ActionPriority::High
                && a.impact == thalos_core::analysis::action::ActionImpact::High
        }));
    }

    #[test]
    fn no_actions_for_empty_observations() {
        let advisor = PlanAdvisor;
        assert!(advisor.advise(&[]).is_empty());
    }

    #[test]
    fn unknown_phenomena_get_no_action() {
        // C2: the advisor proposes actions ONLY for phenomena it has remediation
        // rules for — it never invents knowledge (e.g. a latency spike has no
        // plan-level remediation here).
        use thalos_core::analysis::observation::ObservationKind;
        let observations = vec![observation(1, ObservationKind::LatencySpike)];
        let advisor = PlanAdvisor;
        assert!(advisor.advise(&observations).is_empty());
    }

    #[test]
    fn no_recommendations_for_empty_findings() {
        let advisor = PlanAdvisor;
        let recs = advisor.advise_findings(&[]);
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
        let recs = advisor.advise_findings(&findings);
        assert_eq!(recs.len(), 2);
        assert!(
            recs.iter()
                .any(|r| r.kind == SuggestionKind::Manipulability)
        );
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
        let recs = advisor.advise_findings(&findings);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].kind, SuggestionKind::Collision);
        assert_eq!(recs[0].impact, Impact::High);
    }
}
