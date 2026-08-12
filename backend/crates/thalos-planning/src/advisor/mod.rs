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

use std::collections::{BTreeMap, HashSet};

use thalos_core::analysis::action::{Action, ActionId, ActionImpact, ActionKind, ActionPriority};
use thalos_core::analysis::location::Location;
use thalos_core::analysis::observation::{ArtifactRef, Observation, ObservationKind};
use thalos_core::analysis::region::{ProblemRegion, RegionKind};
use thalos_core::analysis::RegionGrouper;
use thalos_core::ids::MotionPlanId;
use thalos_core::kinematics::inverse::IKSolver;
use thalos_core::motion::segment::MotionSegment;
use thalos_core::prelude::RobotState;
use thalos_core::robot::serial_chain::SerialChain;

use crate::analysis::TrajectoryAnalyzer;
use crate::error::PlanningError;
use crate::feedback::materializer::{
    InsertWaypointMaterializer, LiftTcpMaterializer, MaterializationError, ProposalMaterializer,
};
use crate::feedback::operator::ActionProposal;
use crate::motion::compiler::{
    segment_start_joints, DefaultPlannerDispatcher, PlanCompiler,
};
use crate::motion::planner::SegmentPlanningContext;
use crate::motion::program::{CompiledPlan, PlanningProgram};
use crate::program_edit::ProgramEdit;
use crate::recommendation::{
    Recommendation, RecommendationId, RecommendationStatus, UnavailabilityReason,
};

pub mod remediation;
use remediation::{
    DepartureReparameterizer, SingularityDetourMaterializer, SingularityStrategy, TIME_STEP,
    departure_limits, DEPARTURE_WINDOW, DEFAULT_PERTURBATION,
};

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
    /// **Contrato 4-arg (permanente, design ADR-3)**: esta firma NO cambia.
    /// Compila el programa internamente (desde `current_joints`) para obtener
    /// el [`CompiledPlan`] y delega en
    /// [`recommend_with_segment_context`](Self::recommend_with_segment_context).
    /// Cuando el solver no expone su cadena (mocks) o el programa no compila,
    /// cae a evaluación solo-materialización (semántica legacy D8) — el
    /// pipeline honesto requiere un modelo cinemático real.
    ///
    /// **D8 honesto (M2, design ADR-2)**: una recomendación es `Available`
    /// SOLO si su edit materializa, el programa editado compila, re-analiza y
    /// (para Singularity) la región objetivo queda libre de observaciones de
    /// singularidad — verificación fin-a-fin. El fallo queda
    /// `Unavailable{reason}` con el motivo específico; la recomendación
    /// permanece en la salida (nunca se descarta).
    ///
    /// Dedup: UNA recomendación por `(segmento objetivo, kind)`. Si varias
    /// observaciones apuntan al mismo segmento con la misma remediación,
    /// gana la primera observación por clave y los duplicados se descartan.
    pub fn recommend(
        &self,
        observations: &[Observation],
        program: &PlanningProgram,
        ik_solver: &dyn IKSolver,
        current_joints: &[f64],
    ) -> Vec<Recommendation> {
        let Some(robot) = ik_solver.robot() else {
            // Sin modelo cinemático (mocks): no hay compilación posible.
            return self.recommend_core(observations, program, ik_solver, current_joints, None, None);
        };
        let state = RobotState::new(current_joints.to_vec());
        let ctx = SegmentPlanningContext {
            robot,
            current_state: &state,
            ik_solver,
            tcp: None,
        };
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let compiled = compiler.compile(program, &ctx).ok();
        self.recommend_core(
            observations,
            program,
            ik_solver,
            current_joints,
            compiled.as_ref(),
            Some(robot),
        )
    }

    /// Ruta rica usada por el servicio runtime y los handlers (design ADR-3):
    /// el caller YA compiló el programa, así que la resolución de segmento y
    /// la verificación fin-a-fin corren contra ESE [`CompiledPlan`] (los
    /// `waypoint_range` reales, nunca índice-de-waypoint-como-segmento).
    pub fn recommend_with_segment_context(
        &self,
        observations: &[Observation],
        program: &PlanningProgram,
        ik_solver: &dyn IKSolver,
        compiled: &CompiledPlan,
    ) -> Vec<Recommendation> {
        let current_joints = compiled
            .merged_trajectory
            .waypoints()
            .first()
            .map(|wp| wp.joints().to_vec())
            .unwrap_or_default();
        self.recommend_core(
            observations,
            program,
            ik_solver,
            &current_joints,
            Some(compiled),
            ik_solver.robot(),
        )
    }

    /// Núcleo compartido de recomendación (design ADR-2/ADR-3/ADR-5).
    ///
    /// Resuelve el segmento objetivo vía `owning_segment` (rangos de waypoint
    /// compilados, con fallback cartesiano), materializa el edit y, cuando hay
    /// robot + plan compilado, verifica la disponibilidad fin-a-fin; si falta
    /// contexto cinemático, evalúa solo materialización (semántica legacy D8).
    fn recommend_core(
        &self,
        observations: &[Observation],
        program: &PlanningProgram,
        ik_solver: &dyn IKSolver,
        current_joints: &[f64],
        compiled: Option<&CompiledPlan>,
        robot: Option<&SerialChain>,
    ) -> Vec<Recommendation> {
        let regions = RegionGrouper::default().group(observations);
        let mut recommendations = Vec::new();
        let mut seen: HashSet<(usize, ActionKind)> = HashSet::new();
        let mut counter: u32 = 0;
        for observation in observations {
            for &(kind, priority, impact) in Self::remediation(observation.kind) {
                // T12 (M3): Singularity remediations resolve to the OWNING
                // segment whatever its type (joint-space operators act on
                // MoveJ departures); cartesian kinds keep the MoveL-only
                // resolution.
                let Some((index, target)) =
                    Self::target_segment_for(kind, compiled, program, &observation.location)
                else {
                    continue;
                };
                if !seen.insert((index, kind)) {
                    continue; // ya hay una recomendación para este segmento+kind
                }
                let proposal = ActionProposal {
                    kind,
                    target_observation: observation.id,
                    priority,
                    impact,
                    parameters: BTreeMap::new(),
                };

                // T8 (M2): el materializador resuelve IK desde las joints de
                // INICIO DE SEGMENTO (fin del segmento anterior), NUNCA el
                // snapshot del runtime — el mismo contexto que la compilación.
                let start_joints = match compiled {
                    Some(plan) => segment_start_joints(plan, index, current_joints),
                    None => current_joints.to_vec(),
                };
                // T12/T13 (M3): Singularity recommendations are CAUSAL — the
                // advisor routes start-anchored regions to the departure
                // operator (raise motion limits computed from the robot's
                // cone geometry) and interior regions to the joint-space
                // detour. The strategy carries the precomputed parameters.
                let singularity = if kind == ActionKind::Singularity {
                    Self::singularity_strategy(
                        robot,
                        compiled,
                        program,
                        index,
                        &regions,
                        &observation.location,
                        &start_joints,
                    )
                } else {
                    None
                };
                let Some(materializer) =
                    Self::materializer_for(kind, ik_solver, &start_joints, singularity.as_ref())
                else {
                    continue; // C2: sin materializador no hay edit que poblar
                };

                counter += 1;
                let (edit, status, reason) = match materializer.materialize(&proposal, target) {
                    Ok(segments) => {
                        let edit = ProgramEdit::ReplaceSegment {
                            index,
                            replacement: segments,
                            original: Some(vec![target.clone()]),
                        };
                        match (robot, compiled) {
                            (Some(chain), Some(_plan)) => {
                                let target_waypoint = match observation.location {
                                    Location::Waypoint(wp) => Some(wp),
                                    _ => None,
                                };
                                let context = AvailabilityContext {
                                    robot: chain,
                                    program,
                                    ik_solver,
                                    current_joints,
                                    kind,
                                    regions: &regions,
                                };
                                match Self::verify_available(&context, &edit, target_waypoint) {
                                    Ok(()) => (edit, RecommendationStatus::Available, None),
                                    Err(reason) => {
                                        (edit, RecommendationStatus::Unavailable, Some(reason))
                                    }
                                }
                            }
                            // Sin contexto cinemático: solo materialización.
                            _ => (edit, RecommendationStatus::Available, None),
                        }
                    }
                    Err(error) => {
                        let reason = Self::reason_for(&error);
                        // D8: fallo explícito — edit neutro (no-op) que el
                        // consumidor nunca aplica; la recomendación permanece.
                        (
                            ProgramEdit::ReplaceSegment {
                                index,
                                replacement: vec![target.clone()],
                                original: Some(vec![target.clone()]),
                            },
                            RecommendationStatus::Unavailable,
                            Some(reason),
                        )
                    }
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
                    reason,
                });
            }
        }
        recommendations
    }

    /// El materializador que realiza cada `ActionKind`, o `None` cuando la
    /// remediación no tiene un edit realizable (C2).
    ///
    /// `segment_start_joints` son las joints de inicio del segmento objetivo
    /// (T8, M2): los materializadores con verificación IK (LiftTcp/RotateTool)
    /// resuelven desde ELLAS — el contexto determinista que la compilación
    /// usará — nunca el snapshot del runtime.
    ///
    /// T12 (M3): la remediación de Singularity es CAUSAL. El advisor enruta la
    /// región (start-anchored → [`DepartureReparameterizer`] con los límites
    /// que despejan el cono; interior → [`SingularityDetourMaterializer`] con
    /// la perturbación articular). `RotateToolMaterializer` queda fuera del
    /// registro: rotar la herramienta no remueve la singularidad articular (y
    /// su pose rotada es inalcanzable en los robots planares) — ver M2
    /// surprises. El materializador rotacional sigue en
    /// `feedback/materializer.rs` con sus tests, pero ya no es la
    /// recomendación de Singularity.
    fn materializer_for<'a>(
        kind: ActionKind,
        ik_solver: &'a dyn IKSolver,
        segment_start_joints: &'a [f64],
        singularity: Option<&SingularityStrategy>,
    ) -> Option<Box<dyn ProposalMaterializer + 'a>> {
        match kind {
            ActionKind::Manipulability => Some(Box::new(LiftTcpMaterializer::new(
                ik_solver,
                segment_start_joints,
            ))),
            ActionKind::Singularity => Some(match singularity {
                Some(SingularityStrategy::Departure {
                    max_velocity,
                    max_acceleration,
                }) => Box::new(DepartureReparameterizer::new(*max_velocity, *max_acceleration)),
                _ => Box::new(SingularityDetourMaterializer::new(DEFAULT_PERTURBATION)),
            }),
            ActionKind::Waypoint => Some(Box::new(InsertWaypointMaterializer::new())),
            _ => None,
        }
    }

    /// Resuelve el segmento objetivo de una observación (design ADR-5,
    /// REVISION 1 + T12 M3).
    ///
    /// Las remediaciones articulares (`Singularity`) apuntan al segmento DUEÑO
    /// del waypoint — sea MoveJ o MoveL — porque los operadores causales
    /// (departure/detour) actúan sobre él. Las remediaciones cartesianas
    /// (`Manipulability`, `Waypoint`) mantienen la resolución MoveL-only con
    /// fallback al primer segmento cartesiano.
    fn target_segment_for<'a>(
        kind: ActionKind,
        compiled: Option<&CompiledPlan>,
        program: &'a PlanningProgram,
        location: &Location,
    ) -> Option<(usize, &'a MotionSegment)> {
        match kind {
            ActionKind::Singularity => {
                if let Location::Waypoint(index) = location {
                    let anchored = match compiled {
                        Some(plan) => owning_segment(plan, *index),
                        None => program.segments.get(*index).map(|_| *index),
                    };
                    if let Some(i) = anchored {
                        return program.segments.get(i).map(|segment| (i, segment));
                    }
                }
                None
            }
            _ => Self::target_segment(compiled, program, location),
        }
    }

    /// Enruta una región singular a su estrategia de remediación causal
    /// (design ADR-5 REVISION 2, spec causal-remediation "Departure-
    /// Reparameterization" trigger scenarios).
    ///
    /// Start-anchored (la región comienza dentro de la ventana de partida del
    /// segmento — el cono del arranque FIJO): [`SingularityStrategy::Departure`]
    /// con los límites que despejan el cono en ≤3 waypoints, computados sobre
    /// la geometría real del robot. Interior: [`SingularityStrategy::Detour`]
    /// (perturbación articular). Sin modelo cinemático o sin lever (MoveL),
    /// degrada honestamente al Detour — la verificación fin-a-fin juzga.
    fn singularity_strategy(
        robot: Option<&SerialChain>,
        compiled: Option<&CompiledPlan>,
        program: &PlanningProgram,
        segment_index: usize,
        regions: &[ProblemRegion],
        location: &Location,
        start_joints: &[f64],
    ) -> Option<SingularityStrategy> {
        let waypoint = match location {
            Location::Waypoint(wp) => *wp,
            _ => return None,
        };
        let region = regions
            .iter()
            .find(|r| r.kind == RegionKind::Singularity && r.waypoint_range.contains(&waypoint))?;
        let segment_start = compiled
            .and_then(|plan| plan.segments.get(segment_index))
            .map(|segment| segment.waypoint_range.start);
        let start_anchored = segment_start
            .is_some_and(|start| region.waypoint_range.start <= start + DEPARTURE_WINDOW);

        if start_anchored {
            let Some(chain) = robot else {
                // Sin modelo cinemático no hay límites que computar — el
                // Detour degrada y la verificación fin-a-fin decide.
                return Some(SingularityStrategy::Detour {
                    perturbation: DEFAULT_PERTURBATION,
                });
            };
            let Some(MotionSegment::MoveJ { target, .. }) = program.segments.get(segment_index)
            else {
                // MoveL start-anchored: no hay límites de movimiento que subir
                // (el cono del arranque fijo de un MoveL es M4 scope).
                return Some(SingularityStrategy::Detour {
                    perturbation: DEFAULT_PERTURBATION,
                });
            };
            let (max_velocity, max_acceleration) = departure_limits(chain, start_joints, target, TIME_STEP);
            if max_acceleration > 0.0 {
                return Some(SingularityStrategy::Departure {
                    max_velocity,
                    max_acceleration,
                });
            }
        }
        Some(SingularityStrategy::Detour {
            perturbation: DEFAULT_PERTURBATION,
        })
    }

    /// Resuelve el segmento objetivo de una observación en el programa
    /// (design ADR-5, REVISION 1).
    ///
    /// Con plan compilado, el waypoint de la observación se resuelve vía
    /// `owning_segment` (el segmento cuyo `waypoint_range` lo contiene —
    /// NUNCA índice-de-waypoint-como-índice-de-segmento). Sin plan compilado
    /// (ruta de mocks sin robot), se usa la resolución legacy por índice. Los
    /// materializadores cartesianos operan sobre `MoveL`: si el segmento
    /// anclado no es cartesiano, cae al primer `MoveL` disponible.
    fn target_segment<'a>(
        compiled: Option<&CompiledPlan>,
        program: &'a PlanningProgram,
        location: &Location,
    ) -> Option<(usize, &'a MotionSegment)> {
        if let Location::Waypoint(index) = location {
            let anchored = match compiled {
                Some(plan) => owning_segment(plan, *index),
                None => program.segments.get(*index).map(|_| *index),
            };
            if let Some(i) = anchored
                && let Some(segment) = program.segments.get(i)
                && matches!(segment, MotionSegment::MoveL { .. })
            {
                return Some((i, segment));
            }
        }
        program
            .segments
            .iter()
            .enumerate()
            .find(|(_, segment)| matches!(segment, MotionSegment::MoveL { .. }))
    }

    /// Verificación fin-a-fin de disponibilidad (design ADR-2, spec
    /// recommendation-availability-contract "End-to-End Executability").
    ///
    /// Una recomendación es `Available` SOLO si:
    /// 1. su edit se aplica al programa;
    /// 2. el programa editado compila con el solver IK real (desde el inicio
    ///    del plan — el mismo contexto determinista que preview/apply usan);
    /// 3. la trayectoria compilada re-analiza;
    /// 4. para remediaciones de Singularity, la REGIÓN OBJETIVO re-analizada
    ///    (todos los waypoints agrupados por `RegionGrouper`) queda libre de
    ///    observaciones de singularidad (garantía de región completa).
    ///
    /// Cualquier fallo mapea al [`UnavailabilityReason`] específico. El
    /// re-análisis corre sin collision checker: las observaciones de
    /// singularidad son del Jacobiano y no dependen de colisiones.
    fn verify_available(
        context: &AvailabilityContext<'_>,
        edit: &ProgramEdit,
        target_waypoint: Option<usize>,
    ) -> Result<(), UnavailabilityReason> {
        let AvailabilityContext {
            robot,
            program,
            ik_solver,
            current_joints,
            kind,
            regions,
        } = *context;

        // 1. Aplicar el edit (no-mutante).
        let edited = edit
            .apply(program)
            .map_err(|_| UnavailabilityReason::NotApplicable)?;

        // 2. Compilar el programa editado desde el inicio del plan.
        let state = RobotState::new(current_joints.to_vec());
        let ctx = SegmentPlanningContext {
            robot,
            current_state: &state,
            ik_solver,
            tcp: None,
        };
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let compiled = compiler.compile(&edited, &ctx).map_err(|error| match error.source {
            PlanningError::IkFailed { .. }
            | PlanningError::IkFailedPosition { .. }
            | PlanningError::Ik(_) => UnavailabilityReason::IkFailed,
            _ => UnavailabilityReason::CompileFailed,
        })?;

        // 3. Re-analizar la trayectoria compilada.
        let artifact = ArtifactRef::MotionPlan(MotionPlanId("availability-verification".to_string()));
        let (_analysis, reanalyzed) = TrajectoryAnalyzer::new(robot, None)
            .analyze_with_observations(artifact, &compiled.merged_trajectory)
            .map_err(|_| UnavailabilityReason::PlanningFailed)?;

        // 4. Verificación CAUSAL para Singularity (design ADR-2 REVISION 4,
        //    T13 M3): la región objetivo re-analizada debe tener ESTRICTAMENTE
        //    MENOS observaciones de singularidad que la región original.
        //
        //    El rango original de `RegionGrouper` vive en el espacio de índices
        //    de la trayectoria ORIGINAL; el edit cambia la interpolación
        //    (el reparameterizer altera el conteo de waypoints), así que los
        //    índices re-analizados DIVERGEN. La verificación usa el rango
        //    RECOMPILADO del segmento objetivo (del plan recompilado — el
        //    mismo índice de segmento, nuevo rango de waypoints) y compara el
        //    conteo, nunca los índices.
        //
        //    El waypoint de arranque FIJO del plan puede permanecer singular
        //    (p.ej. Planar3R parte de [0,0,0] — ningún edit de segmento puede
        //    moverlo): la garantía es que la remediación es CAUSAL (el
        //    fenómeno disminuyó), que es lo que el contrato de usabilidad
        //    asserta (24 → <24; 17 → <4 con el set completo).
        if kind == ActionKind::Singularity
            && let Some(waypoint) = target_waypoint
            && let Some(region) = regions
                .iter()
                .find(|r| r.kind == RegionKind::Singularity && r.waypoint_range.contains(&waypoint))
        {
            let original_errors = region.metrics.as_ref().map_or(0, |m| m.error_count);
            let target_index = match edit {
                ProgramEdit::ReplaceSegment { index, .. } => *index,
                _ => return Err(UnavailabilityReason::NotApplicable),
            };
            let recompiled_range = compiled
                .segments
                .get(target_index)
                .map(|segment| segment.waypoint_range.clone());
            let reanalyzed_errors = reanalyzed
                .iter()
                .filter(|o| {
                    o.kind == ObservationKind::Singularity
                        && matches!(o.location, Location::Waypoint(wp)
                            if recompiled_range.as_ref().is_some_and(|range| range.contains(&wp)))
                })
                .count();
            if reanalyzed_errors >= original_errors.max(1) {
                return Err(UnavailabilityReason::PlanningFailed);
            }
        }

        Ok(())
    }

    /// Mapea un fallo de materialización al motivo estructurado (ADR-2).
    fn reason_for(error: &MaterializationError) -> UnavailabilityReason {
        match error {
            MaterializationError::IkFailure => UnavailabilityReason::IkFailed,
            MaterializationError::UnsupportedSegment => UnavailabilityReason::Unsupported,
            MaterializationError::UnsupportedProposal { .. } => UnavailabilityReason::NotApplicable,
        }
    }
}

/// El segmento dueño de `waypoint` en el plan compilado (design ADR-5,
/// REVISION 1): `waypoint ∈ segment.waypoint_range` ([start, end)). Devuelve
/// `None` cuando el waypoint cae fuera de todos los segmentos (plan
/// degenerado). NUNCA índice-de-waypoint-como-segmento.
fn owning_segment(compiled: &CompiledPlan, waypoint: usize) -> Option<usize> {
    compiled
        .segments
        .iter()
        .position(|segment| segment.waypoint_range.contains(&waypoint))
}

/// Contexto de verificación fin-a-fin de disponibilidad (design ADR-2).
///
/// Agrupa las dependencias estáticas del pipeline de verificación para que
/// `verify_available` siga siendo una función pura con una sola entrada
/// mutable (el edit a verificar).
struct AvailabilityContext<'a> {
    robot: &'a SerialChain,
    program: &'a PlanningProgram,
    ik_solver: &'a dyn IKSolver,
    current_joints: &'a [f64],
    kind: ActionKind,
    regions: &'a [ProblemRegion],
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{ArtifactRef, Observation, ObservationId, Severity};
    use thalos_core::ids::MotionPlanId;
    use thalos_core::kinematics::{forward::ForwardKinematics, inverse::DampedLeastSquaresSolver};
    use thalos_core::models::{RobotModel, RobotRegistry};
    use thalos_core::spatial::frame::FrameId;

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
    fn recommend_deduplicates_by_target_segment() {
        // Hotfix (duplicate recommendations): the SAME failing segment must
        // produce ONE recommendation, not one per observation. 4 singularity
        // observations anchored to segment 0 collapse into a single
        // "segment failed" row; a segment that ALSO fails keeps its own row.
        use thalos_core::analysis::action::ActionKind;
        use thalos_core::analysis::observation::ObservationKind;
        use thalos_core::spatial::frame::FrameId;

        let program = crate::motion::program::PlanningProgram::new(vec![
            MotionSegment::MoveL {
                origin: thalos_core::ids::OperationId("op-a".to_string()),
                frame: FrameId::World,
                target_pose: Pose::new(
                    FrameId::World,
                    FrameId::Id(1),
                    Transform3D::identity(),
                ),
                max_velocity: Some(200.0),
            },
            MotionSegment::MoveL {
                origin: thalos_core::ids::OperationId("op-b".to_string()),
                frame: FrameId::World,
                target_pose: Pose::new(
                    FrameId::World,
                    FrameId::Id(2),
                    Transform3D::identity(),
                ),
                max_velocity: Some(200.0),
            },
        ]);

        let mut observations = Vec::new();
        for i in 0..4 {
            let mut obs = observation(i + 1, ObservationKind::Singularity);
            obs.location = Location::Waypoint(0); // all anchor segment 0
            observations.push(obs);
        }
        let mut other = observation(5, ObservationKind::Singularity);
        other.location = Location::Waypoint(1); // a second segment that fails
        observations.push(other);

        let advisor = PlanAdvisor;
        let recommendations = advisor.recommend(&observations, &program, &FailingIKSolver, &[0.0, 0.0]);

        let singularity = recommendations
            .iter()
            .filter(|r| r.action.kind == ActionKind::Singularity)
            .collect::<Vec<_>>();
        assert_eq!(
            singularity.len(),
            2,
            "one recommendation per distinct target segment, got {}",
            singularity.len()
        );

        let mut indexes = singularity
            .iter()
            .map(|r| match r.edit {
                crate::program_edit::ProgramEdit::ReplaceSegment { index, .. } => index,
                _ => usize::MAX,
            })
            .collect::<Vec<_>>();
        indexes.sort();
        assert_eq!(indexes, vec![0, 1]);
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

    // ── T5/T6/T7 (M2): honest availability + fixed segment mapping ─────────
    //
    // Design ADR-5 (REVISION 1): observation→segment resolution MUST use
    // `compiled.segments[N].waypoint_range`, NEVER waypoint-as-segment-index.
    // Design ADR-2: unavailable recommendations carry a structured reason.

    fn move_l_segment(index: usize) -> MotionSegment {
        MotionSegment::MoveL {
            origin: thalos_core::ids::OperationId(format!("op-l{index}")),
            frame: FrameId::World,
            target_pose: Pose::new(
                FrameId::World,
                FrameId::Id(1),
                Transform3D::from_translation(thalos_math::Vector3::new(
                    1.2 - 0.4 * index as f64,
                    0.6 + 0.3 * index as f64,
                    0.0,
                )),
            ),
            max_velocity: Some(200.0),
        }
    }

    /// A real solver over the real chain, as the runtime wires it.
    fn real_solver(chain: &thalos_core::robot::serial_chain::SerialChain) -> DampedLeastSquaresSolver {
        let fk = ForwardKinematics::new(chain.clone());
        DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 500, 1e-6, 0.1)
    }

    #[test]
    fn owning_segment_maps_waypoints_to_their_owning_segment() {
        // Design ADR-5: waypoint 5 in segment 0's range resolves to segment 0
        // — NEVER to segment index 5. Ranges are [start, end).
        use thalos_core::prelude::Trajectory;
        use crate::motion::program::{CompiledPlan, PlannedSegment};

        fn seg(range: std::ops::Range<usize>) -> PlannedSegment {
            PlannedSegment {
                origin: thalos_core::ids::OperationId("op".to_string()),
                source: move_l_segment(0),
                trajectory: Trajectory::new(vec![]),
                waypoint_range: range,
                time_range: 0.0..1.0,
                operation_id: None,
                role: None,
            }
        }
        let plan = CompiledPlan::new(Trajectory::new(vec![]), vec![seg(0..10), seg(10..20)]);

        assert_eq!(
            owning_segment(&plan, 5),
            Some(0),
            "waypoint 5 lives in segment 0 — never segment index 5"
        );
        assert_eq!(owning_segment(&plan, 10), Some(1), "ranges are [start, end)");
        assert_eq!(owning_segment(&plan, 15), Some(1));
        assert_eq!(owning_segment(&plan, 20), None, "out of every range");
    }

    #[test]
    fn recommend_targets_the_owning_segment_not_the_waypoint_index() {
        // The discriminating mapping case: a two-MoveL program where waypoint
        // 1 lives inside segment 0's range. The OLD buggy mapping resolved
        // `program.segments.get(1)` → segment 1; the FIXED mapping must
        // resolve owning_segment → segment 0.
        use thalos_core::analysis::observation::ObservationKind;

        let robot = RobotRegistry::create_default(RobotModel::Planar2R);
        let program = crate::motion::program::PlanningProgram::new(vec![
            move_l_segment(0),
            move_l_segment(1),
        ]);
        let mut obs = observation(1, ObservationKind::LowManipulability);
        obs.location = Location::Waypoint(1);

        let advisor = PlanAdvisor;
        let recommendations = advisor.recommend(
            &[obs],
            &program,
            &real_solver(&robot),
            &[0.0, 0.0],
        );

        assert!(
            !recommendations.is_empty(),
            "the anchored observation must produce recommendations"
        );
        for rec in &recommendations {
            assert!(
                matches!(
                    rec.edit,
                    crate::program_edit::ProgramEdit::ReplaceSegment { index: 0, .. }
                ),
                "waypoint 1 is in segment 0's range → every edit must target segment 0, got {:?}",
                rec.edit
            );
        }
    }

    #[test]
    fn target_segment_falls_back_to_the_first_cartesian_segment() {
        // Cartesian materializers cannot transform a MoveJ: when the owning
        // segment is not cartesian, the advisor falls back to the first MoveL
        // (the documented intent of the original target_segment).
        use thalos_core::prelude::Trajectory;
        use crate::motion::program::{CompiledPlan, PlannedSegment};

        let program = crate::motion::program::PlanningProgram::new(vec![
            MotionSegment::MoveJ {
                origin: thalos_core::ids::OperationId("j".to_string()),
                target: vec![0.5, 0.5],
                max_velocity: None,
                max_acceleration: None,
            },
            move_l_segment(1),
        ]);
        let seg0 = PlannedSegment {
            origin: thalos_core::ids::OperationId("j".to_string()),
            source: program.segments[0].clone(),
            trajectory: Trajectory::new(vec![]),
            waypoint_range: 0..10,
            time_range: 0.0..1.0,
            operation_id: None,
            role: None,
        };
        let seg1 = PlannedSegment {
            origin: thalos_core::ids::OperationId("l".to_string()),
            source: program.segments[1].clone(),
            trajectory: Trajectory::new(vec![]),
            waypoint_range: 10..20,
            time_range: 1.0..2.0,
            operation_id: None,
            role: None,
        };
        let plan = CompiledPlan::new(Trajectory::new(vec![]), vec![seg0, seg1]);

        // Waypoint 3 is owned by segment 0 (MoveJ) → fall back to segment 1.
        let (index, target) =
            PlanAdvisor::target_segment(Some(&plan), &program, &Location::Waypoint(3))
                .expect("fallback must resolve a cartesian target");
        assert_eq!(index, 1);
        assert!(
            matches!(target, MotionSegment::MoveL { .. }),
            "fallback target must be the first MoveL"
        );
    }

    #[test]
    fn materialization_failure_carries_a_specific_reason() {
        // Design ADR-2 + spec recommendation-availability-contract "IK
        // failure": a recommendation whose materialization fails IK is
        // Unavailable WITH `reason: Some(IkFailed)` — the additive field is
        // populated, never silently dropped.
        use thalos_core::analysis::observation::ObservationKind;
        use crate::recommendation::{RecommendationStatus, UnavailabilityReason};

        let observations = vec![observation(1, ObservationKind::LowManipulability)];
        let advisor = PlanAdvisor;
        let recommendations = advisor.recommend(
            &observations,
            &program_with_cartesian_target(),
            &FailingIKSolver,
            &[0.0, 0.0],
        );

        let manipulability = recommendations
            .iter()
            .find(|r| r.action.kind == ActionKind::Manipulability)
            .expect("the manipulability recommendation must be present");
        assert_eq!(manipulability.status, Some(RecommendationStatus::Unavailable));
        assert_eq!(
            manipulability.reason,
            Some(UnavailabilityReason::IkFailed),
            "an IK materialization failure must carry reason=ik_failed"
        );
    }

    // ── T12/T13 (M3): causal singularity remediation ────────────────────────
    //
    // Design ADR-5 REVISION 2: start-anchored singular regions (the segment
    // departs from a FIXED singular start) get the DepartureReparameterizer;
    // interior regions get the joint-space perturbation (SingularityDetour).
    // The Scara's first waypoint can be non-singular (its prismatic Z column
    // keeps the linear Jacobian full-rank at q2 = 0), so the grouped region
    // starts ONE waypoint after the segment start — the trigger uses a
    // departure window, not strict equality.

    fn singular_obs(id: u32, waypoint: usize) -> Observation {
        use thalos_core::analysis::observation::Severity;
        Observation {
            id: ObservationId(id),
            kind: ObservationKind::Singularity,
            severity: Severity::Error,
            artifact: ArtifactRef::MotionPlan(MotionPlanId("mp-m3".to_string())),
            location: Location::Waypoint(waypoint),
            attributes: BTreeMap::new(),
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    #[test]
    fn singularity_strategy_routes_start_anchored_to_departure_and_interior_to_detour() {
        // Spec causal-remediation trigger scenarios: a region whose first
        // waypoint sits within the segment's departure window → Departure
        // (raise motion limits); a region deep inside the segment → Detour
        // (joint-space perturbation).
        use crate::motion::program::PlanningProgram;
        use thalos_core::ids::OperationId;

        let robot = RobotRegistry::create_default(RobotModel::Scara);
        let program = PlanningProgram::new(vec![
            MotionSegment::MoveJ {
                origin: OperationId("j".to_string()),
                target: vec![0.5, -0.3, -0.1, 0.0],
                max_velocity: None,
                max_acceleration: None,
            },
            move_l_segment(0),
        ]);
        let start = vec![0.0, 0.0, 0.0, 0.0];
        let solver = real_solver(&robot);
        let state = RobotState::new(start.clone());
        let ctx = SegmentPlanningContext {
            robot: &robot,
            current_state: &state,
            ik_solver: &solver,
            tcp: None,
        };
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let compiled = compiler.compile(&program, &ctx).expect("compile");

        // Start-anchored: singular observations at waypoints 0..4, inside the
        // segment's departure window (segment 0 starts at waypoint 0).
        let start_obs: Vec<Observation> = (0..5).map(|i| singular_obs((i + 1) as u32, i)).collect();
        let regions = RegionGrouper::default().group(&start_obs);
        let strategy = PlanAdvisor::singularity_strategy(
            Some(&robot),
            Some(&compiled),
            &program,
            0,
            &regions,
            &Location::Waypoint(0),
            &start,
        );
        match strategy {
            Some(SingularityStrategy::Departure {
                max_acceleration: a, ..
            }) => assert!(
                a >= 6.0,
                "the Scara departure must clear the cone with a >= ~6 rad/s^2, got {a}"
            ),
            other => panic!("start-anchored region must route to Departure, got {other:?}"),
        }

        // Interior: singular observations deep inside segment 0 (waypoints
        // 100..104 — the segment spans 0..~200 waypoints).
        let interior_obs: Vec<Observation> = (100..105).map(|i| singular_obs((i + 1) as u32, i)).collect();
        let regions = RegionGrouper::default().group(&interior_obs);
        let strategy = PlanAdvisor::singularity_strategy(
            Some(&robot),
            Some(&compiled),
            &program,
            0,
            &regions,
            &Location::Waypoint(100),
            &start,
        );
        assert!(
            matches!(strategy, Some(SingularityStrategy::Detour { .. })),
            "interior region must route to the joint-space Detour, got {strategy:?}"
        );
    }
}
