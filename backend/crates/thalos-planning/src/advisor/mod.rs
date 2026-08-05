//! Generación de acciones de remediación a partir de observaciones.
//!
//! El [`PlanAdvisor`] toma [`Observation`](thalos_core::analysis::observation::Observation)s
//! producidas por los analizadores y las transforma en
//! [`Action`](thalos_core::analysis::action::Action)s que las referencian por
//! id (I5, spec analysis-report-contract).
//!
//! **Principio**: El Advisor NUNCA recalcula. Solo interpreta observaciones.
//! No vuelve a preguntar al Jacobiano, no vuelve a consultar colisiones.
//! No llama a FK. No llama a SVD.
//!
//! PR 7a: el camino legacy `advise_findings`/`Recommendation` fue eliminado —
//! todo el wire format habla observaciones; la remediación son [`Action`]s.

use std::collections::BTreeMap;

use thalos_core::analysis::action::{Action, ActionId, ActionImpact, ActionKind, ActionPriority};
use thalos_core::analysis::location::Location;
use thalos_core::analysis::observation::{Observation, ObservationKind};
use thalos_core::kinematics::inverse::IKSolver;
use thalos_core::motion::segment::MotionSegment;

use crate::feedback::materializer::{
    InsertWaypointMaterializer, LiftTcpMaterializer, ProposalMaterializer, RotateToolMaterializer,
};
use crate::feedback::operator::ActionProposal;
use crate::motion::program::PlanningProgram;
use crate::program_edit::ProgramEdit;
use crate::recommendation::{Recommendation, RecommendationId, RecommendationStatus};

/// Generador de acciones.
///
/// Toma `Vec<Observation>` y produce `Vec<Action>`.
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
                    id: ActionId(0), // el consumidor/aggregator reasigna ids únicos
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

    /// PR2: convierte observaciones en [`Recommendation`]s con `edit` poblado
    /// vía los materializers (spec recommendation-model "Materializers").
    ///
    /// La ruta de recomendaciones es un SUPERSET de [`PlanAdvisor::advise`]:
    /// por cada acción de remediación con un materializador disponible, el
    /// advisor resuelve el segmento objetivo desde la ubicación de la
    /// observación y materializa el edit (`ProgramEdit::ReplaceSegment`). Las
    /// acciones sin materializador (Velocity, Collision, Constraint) no
    /// producen recomendación (C2: el advisor nunca inventa el HOW).
    ///
    /// D8: cuando la materialización falla (IK sin solución, segmento no
    /// soportado) la recomendación NO se descarta — se marca
    /// `status: unavailable` y permanece en la salida con un edit neutro.
    pub fn recommend(
        &self,
        observations: &[Observation],
        program: &PlanningProgram,
        ik_solver: &dyn IKSolver,
        current_joints: &[f64],
    ) -> Vec<Recommendation> {
        let mut recommendations = Vec::new();
        let mut counter: u32 = 0;
        for observation in observations {
            for &(kind, priority, impact) in Self::remediation(observation.kind) {
                let Some(materializer) = Self::materializer_for(kind, ik_solver, current_joints)
                else {
                    continue; // C2: sin materializador no hay edit que poblar
                };
                let Some((index, target)) = Self::target_segment(program, &observation.location)
                else {
                    continue;
                };
                let proposal = ActionProposal {
                    kind,
                    target_observation: observation.id,
                    priority,
                    impact,
                    parameters: BTreeMap::new(),
                };
                counter += 1;
                let (edit, status) = match materializer.materialize(&proposal, target) {
                    Ok(segments) => (
                        ProgramEdit::ReplaceSegment {
                            index,
                            replacement: segments,
                            original: Some(vec![target.clone()]),
                        },
                        RecommendationStatus::Available,
                    ),
                    Err(_) => (
                        // D8: fallo explícito — edit neutro (no-op) que el
                        // consumidor nunca aplica; la recomendación permanece.
                        ProgramEdit::ReplaceSegment {
                            index,
                            replacement: vec![target.clone()],
                            original: Some(vec![target.clone()]),
                        },
                        RecommendationStatus::Unavailable,
                    ),
                };
                recommendations.push(Recommendation {
                    id: RecommendationId(counter),
                    action: Action {
                        id: ActionId(counter),
                        kind,
                        target_observation: observation.id,
                        priority,
                        impact,
                        parameters: BTreeMap::new(),
                    },
                    edit,
                    status: Some(status),
                });
            }
        }
        recommendations
    }

    /// El materializador que realiza cada `ActionKind`, o `None` cuando la
    /// remediación no tiene un edit realizable (C2).
    fn materializer_for<'a>(
        kind: ActionKind,
        ik_solver: &'a dyn IKSolver,
        current_joints: &'a [f64],
    ) -> Option<Box<dyn ProposalMaterializer + 'a>> {
        match kind {
            ActionKind::Manipulability => Some(Box::new(LiftTcpMaterializer::new(
                ik_solver,
                current_joints,
            ))),
            ActionKind::Singularity => Some(Box::new(RotateToolMaterializer::new())),
            ActionKind::Waypoint => Some(Box::new(InsertWaypointMaterializer::new())),
            _ => None,
        }
    }

    /// Resuelve el segmento objetivo de una observación en el programa.
    ///
    /// Los materializadores cartesianos (LiftTcp/RotateTool/InsertWaypoint)
    /// operan sobre segmentos `MoveL`. Prefiere el segmento anclado por la
    /// ubicación de la observación; si el índice cae fuera del programa o el
    /// segmento anclado no es cartesiano, cae al primer `MoveL` disponible.
    fn target_segment<'a>(
        program: &'a PlanningProgram,
        location: &Location,
    ) -> Option<(usize, &'a MotionSegment)> {
        if let Location::Waypoint(index) = location
            && let Some(segment) = program.segments.get(*index)
        {
            return Some((*index, segment));
        }
        program
            .segments
            .iter()
            .enumerate()
            .find(|(_, segment)| matches!(segment, MotionSegment::MoveL { .. }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{ArtifactRef, Observation, ObservationId, Severity};
    use thalos_core::ids::MotionPlanId;

    fn observation(id: u32, kind: ObservationKind) -> Observation {
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

    // ── PR2 (tasks 2.2 + 2.4): recommend → Vec<Recommendation> ─────────────

    use thalos_core::kinematics::inverse::{IKGoal, IKResult, IKSolver, IkError};
    use thalos_core::motion::segment::MotionSegment;
    use thalos_core::spatial::pose::Pose;
    use thalos_math::Transform3D;

    /// Mock IK solver that never converges — forces `status: unavailable`.
    struct FailingIKSolver;

    impl IKSolver for FailingIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> Result<IKResult, IkError> {
            Ok(IKResult::max_iterations(q0.to_vec(), 100, 1.5, None))
        }
    }

    /// A two-segment program: a MoveL at index 0 (the singular/plan problem
    /// target) and a MoveJ at index 1.
    fn program_with_cartesian_target() -> crate::motion::program::PlanningProgram {
        use crate::motion::program::PlanningProgram;
        use thalos_core::ids::OperationId;
        use thalos_core::spatial::frame::FrameId;
        PlanningProgram::new(vec![
            MotionSegment::MoveL {
                origin: OperationId("op-l".to_string()),
                frame: FrameId::World,
                target_pose: Pose::new(FrameId::World, FrameId::Id(1), Transform3D::identity()),
                max_velocity: Some(200.0),
            },
            MotionSegment::MoveJ {
                origin: OperationId("op-j".to_string()),
                target: vec![0.0, 0.0],
                max_velocity: Some(500.0),
                max_acceleration: Some(1000.0),
            },
        ])
    }

    #[test]
    fn ik_failure_marks_recommendation_unavailable_but_keeps_it() {
        // Spec recommendation-model "IK failure produces unavailable status"
        // + design D8: when IK fails during materialization the recommendation
        // MUST be marked `status: unavailable` and MUST still be present in the
        // output — never silently dropped.
        use thalos_core::analysis::action::ActionKind;
        use thalos_core::analysis::observation::ObservationKind;

        let observations = vec![observation(1, ObservationKind::LowManipulability)];
        let advisor = PlanAdvisor;
        let recommendations = advisor.recommend(
            &observations,
            &program_with_cartesian_target(),
            &FailingIKSolver,
            &[0.0, 0.0],
        );

        // D8: the failing recommendation is NOT dropped.
        let unavailable = recommendations
            .iter()
            .filter(|r| r.action.kind == ActionKind::Manipulability)
            .collect::<Vec<_>>();
        assert!(
            !unavailable.is_empty(),
            "the manipulability recommendation must still be present"
        );
        for rec in unavailable {
            assert_eq!(
                rec.status,
                Some(crate::recommendation::RecommendationStatus::Unavailable),
                "IK failure must be surfaced explicitly, never dropped"
            );
        }
        // The other remediation (Waypoint) materializes fine.
        assert!(
            recommendations
                .iter()
                .any(|r| r.action.kind == ActionKind::Waypoint
                    && r.status == Some(crate::recommendation::RecommendationStatus::Available)),
            "materializable recommendations stay available"
        );
    }

    #[test]
    fn recommend_produces_recommendations_with_edits() {
        // Task 2.4: recommend() → Vec<Recommendation> — every recommendation
        // carries a typed ProgramEdit (design D3), never a string.
        use thalos_core::analysis::observation::ObservationKind;
        let observations = vec![observation(1, ObservationKind::LowManipulability)];
        let advisor = PlanAdvisor;
        let recommendations = advisor.recommend(
            &observations,
            &program_with_cartesian_target(),
            &FailingIKSolver,
            &[0.0, 0.0],
        );

        assert!(!recommendations.is_empty());
        for rec in &recommendations {
            assert!(
                matches!(
                    rec.edit,
                    crate::program_edit::ProgramEdit::ReplaceSegment { .. }
                ),
                "each recommendation must carry a typed edit, got {:?}",
                rec.edit
            );
            assert_eq!(rec.action.target_observation, observations[0].id);
        }
    }

    #[test]
    fn recommend_uses_the_observations_anchored_segment() {
        // The advisor resolves the target segment from the observation's
        // location: an in-bounds Waypoint anchor targets that exact index.
        use thalos_core::analysis::observation::ObservationKind;

        let mut obs = observation(1, ObservationKind::LowManipulability);
        obs.location = Location::Waypoint(0);
        let advisor = PlanAdvisor;
        let recommendations = advisor.recommend(
            &[obs],
            &program_with_cartesian_target(),
            &FailingIKSolver,
            &[0.0, 0.0],
        );

        assert!(
            recommendations.iter().all(|r| matches!(
                r.edit,
                crate::program_edit::ProgramEdit::ReplaceSegment { index: 0, .. }
            )),
            "anchored observation must target segment 0"
        );
    }
}
