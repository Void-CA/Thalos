//! Servicio de análisis de trayectorias planificadas.
//!
//! Orquesta el pipeline de análisis sobre un plan activo:
//! 1. Obtiene la trayectoria desde el runtime
//! 2. Evalúa cada waypoint (FK, Jacobiano, singularidad, manipulabilidad, colisiones)
//! 3. (PR 3) Emite observaciones canónicas ancladas al plan (I3) y las agrega a un
//!    [`AnalysisReport`] vía `DefaultAggregator` (D2/D3)
//! 4. (PR 3) El `PlanAdvisor` genera [`Action`]s sobre las observaciones (I5)
//! 5. Retorna el reporte canónico + el análisis técnico por waypoint (métricas
//!    para el pipeline de optimización)
//!
//! PR 7a: los campos legacy `findings`/`recommendations` se eliminaron — el
//! contrato HTTP es una proyección del [`AnalysisReport`] (spec
//! motion-plan-endpoint), no un modelo intermedio.

use thalos_collision::NaiveCollisionChecker;
use thalos_core::{
    analysis::action::ActionId,
    analysis::aggregator::{Aggregator, DefaultAggregator},
    analysis::constraints::{Constraint, DefaultConstraintEvaluator},
    analysis::observation::ArtifactRef,
    analysis::report::AnalysisReport,
    analysis::scoring::DefaultScoringPolicy,
    collision::CollisionMatrix,
    prelude::RobotState,
    robot::{serial_chain::SerialChain, tool_frame::ToolFrame},
};
use thalos_intelligence::Risk;
use thalos_planning::{
    advisor::PlanAdvisor,
    analysis::{PlanAnalysis, TrajectoryAnalyzer},
    candidate::{
        AdmissibilityGate, CandidateAssessment, CandidateEvaluator, CandidateGenerationContext,
        CandidateGenerator, CandidateRanking, GateCandidate, JointBounds, MotionMetrics,
        ObjectiveProfile, RiskAdmissibility,
    },
    motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
        program::PlanningProgram,
    },
    recommendation::Recommendation,
};

use crate::error::RuntimeError;

/// Resultado completo del análisis de un plan.
#[derive(Debug, Clone)]
pub struct PlanAnalysisResult {
    /// Análisis técnico por waypoint y métricas agregadas (consumido por el
    /// pipeline de optimización — métricas before/after).
    pub analysis: PlanAnalysis,
    /// Reporte canónico agregado (PR 3): observaciones + acciones + summary,
    /// `validate()`-safe. Es la proyección del wire de `/plan/analyze`.
    pub report: AnalysisReport,
    /// Recomendaciones de remediación (PR2, spec recommendation-model): cada
    /// una lleva `action` + `edit` (comando semántico de plan). ADITIVO — el
    /// contrato wire la expone con `#[serde(default)]`. Se puebla cuando el
    /// flujo de análisis dispone de un programa + solver (R3-001:
    /// `analyze_plan_with_recommendations`); en el análisis puro queda vacía
    /// (clientes antiguos no afectados).
    pub recommendations: Vec<Recommendation>,
    /// Verdicto de inteligencia (thalos-intelligence): riesgo + calidad +
    /// traza, computado como paso final PURO sobre el reporte agregado
    /// (`Assessor::assess(&report)`). ADITIVO en el wire (`#[serde(default)]`).
    pub assessment: thalos_intelligence::Assessment,
    /// Ranking de candidatos alternativos (PR3): la composición completa
    /// `generate → compile → analyze → assess → map → gate → rank` sobre el
    /// programa semántico (design ADR-5 — el runtime es el único componente
    /// que conoce ambos lados del contrato). ADITIVO — `None` cuando el flujo
    /// no dispone de programa + solver (`analyze_plan`); el wire lo expone
    /// con `#[serde(default)]` y los clientes antiguos no cambian.
    pub candidate_ranking: Option<CandidateRanking>,
}

/// Servicio de análisis de planes.
///
/// Stateless — todas las dependencias se inyectan por parámetro.
pub struct PlanAnalysisService;

impl PlanAnalysisService {
    /// Analiza una trayectoria completa de un plan.
    ///
    /// # Parámetros
    ///
    /// - `chain`: Cadena cinemática del robot
    /// - `trajectory`: Trayectoria a analizar (desde el plan activo)
    /// - `tcp`: Tool Center Point opcional
    /// - `constraints`: Restricciones opcionales a evaluar
    /// - `artifact`: Ancla (I3) del plan analizado — cada observación del
    ///   reporte referencia este [`ArtifactRef`]
    ///
    /// # Retorna
    ///
    /// `PlanAnalysisResult` con el reporte canónico (observaciones + acciones
    /// + summary) y el análisis técnico por waypoint (métricas para
    /// optimización).
    pub fn analyze_plan(
        chain: &SerialChain,
        trajectory: &thalos_core::trajectory::Trajectory,
        tcp: Option<&ToolFrame>,
        constraints: Option<&[Constraint]>,
        artifact: ArtifactRef,
    ) -> Result<PlanAnalysisResult, RuntimeError> {
        let checker = NaiveCollisionChecker;
        let matrix = CollisionMatrix::new();
        let evaluator = DefaultConstraintEvaluator;

        let mut analyzer =
            TrajectoryAnalyzer::new(chain, tcp).with_collision_checker(&checker, &matrix);

        if let Some(c) = constraints {
            analyzer = analyzer.with_constraints(c, &evaluator);
        }

        // Pasa único: análisis técnico + observaciones canónicas (PR 7a).
        let (analysis, observations) =
            analyzer.analyze_with_observations(artifact.clone(), trajectory)?;

        // Agregación canónica: observaciones → AnalysisReport (D3). El
        // aggregator reasigna ids 1..=n (I8), así que las acciones se generan
        // SOBRE las observaciones del reporte para referenciar ids reales.
        // (S1) Las métricas del análisis técnico se pasan AL aggregator
        // (design ADR-1): pueblan `report.metrics` Y alimentan el componente
        // continuo del quality_index en la misma llamada — el aggregator es
        // source-agnostic (no conoce `PlanAnalysis`), el servicio — composition
        // root — conecta ambas proyecciones. ADITIVO: solo llena un campo que
        // llegaba vacío (`{}`).
        let mut report = DefaultAggregator::new(DefaultScoringPolicy).aggregate_with_metrics(
            artifact,
            observations,
            analysis.metrics.to_btree_map(),
        );

        // El Advisor solo interpreta observaciones, nunca recalcula (C2); las
        // acciones viven en el reporte y referencian observaciones por id (I5).
        let mut actions = PlanAdvisor.advise(&report.observations);
        for (index, action) in actions.iter_mut().enumerate() {
            action.id = ActionId((index + 1) as u32);
        }
        report.actions = actions;

        // (IA) Paso final PURO: el `Assessor` interpreta `report.metrics` en
        // riesgo/calidad. Se ejecuta DESPUÉS de poblar las métricas y SOLO lee
        // el reporte — nunca lo muta, ni toca planner/runtime (spec
        // intelligent-assessment "Read-Only Architectural Constraint").
        let assessment = thalos_intelligence::Assessor::assess(&report);

        Ok(PlanAnalysisResult {
            analysis,
            report,
            // PR2: aditivo — el análisis puro no dispone de programa+solver
            // para materializar edits; los flujos con contexto de plan usan
            // `analyze_plan_with_recommendations`. El wire lo expone con
            // serde default, así que los clientes antiguos no cambian (I3).
            recommendations: Vec::new(),
            assessment,
            // PR3: aditivo — sin programa+solver no hay candidatos que
            // generar; `analyze_plan_with_candidates` lo puebla.
            candidate_ranking: None,
        })
    }

    /// Variante de [`analyze_plan`] que además puebla `recommendations` desde
    /// el contexto de plan disponible (programa semántico + solver IK + joints
    /// actuales, PR2).
    ///
    /// Este es el camino del endpoint `/plan/analyze` (R3-001): la UI consume
    /// SOLO la proyección de `analyze`, así que el flujo real debe producir las
    /// filas de recomendación aquí. Un programa vacío produce
    /// `recommendations` vacío (el advisor no puede resolver segmentos
    /// objetivo) — nunca un vacío silencioso: los flujos sin contexto de plan
    /// no proyectan el campo (aditivo en el wire).
    ///
    /// M2 (design ADR-3): el servicio compila el programa (desde
    /// `current_joints`) y le pasa el [`CompiledPlan`] al advisor vía
    /// `recommend_with_segment_context` — la verificación fin-a-fin de
    /// disponibilidad corre contra los `waypoint_range` REALES del plan
    /// compilado (fix ADR-5: nunca índice-de-waypoint-como-segmento).
    pub fn analyze_plan_with_recommendations(
        chain: &SerialChain,
        trajectory: &thalos_core::trajectory::Trajectory,
        tcp: Option<&ToolFrame>,
        constraints: Option<&[Constraint]>,
        artifact: ArtifactRef,
        program: &PlanningProgram,
        ik_solver: &dyn thalos_core::kinematics::inverse::IKSolver,
        current_joints: &[f64],
    ) -> Result<PlanAnalysisResult, RuntimeError> {
        let mut result = Self::analyze_plan(chain, trajectory, tcp, constraints, artifact)?;

        // Compilar el programa para obtener el contexto de segmentos
        // (waypoint_range + joints de inicio de segmento) — el mismo compile
        // determinista que `recommend` (4-arg) haría internamente, con el
        // MISMO TCP activo que preview/apply (R3-3 P0).
        let state = RobotState::new(current_joints.to_vec());
        let ctx = SegmentPlanningContext {
            robot: chain,
            current_state: &state,
            ik_solver,
            tcp,
        };
        let compiled = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()))
            .compile(program, &ctx)
            .map_err(|e| RuntimeError::Planning(e.into()))?;

        result.recommendations = PlanAdvisor.recommend_with_segment_context(
            &result.report.observations,
            program,
            ik_solver,
            &compiled,
            tcp,
        );
        Ok(result)
    }

    /// Variante de [`analyze_plan_with_recommendations`] que además compone el
    /// pipeline de candidatos (PR3, design data flow): sobre el programa
    /// semántico, genera alternativas y las evalúa hasta un ranking:
    ///
    /// ```text
    /// CandidateGenerator::generate → per candidate (PlanCompiler →
    /// TrajectoryAnalyzer → DefaultAggregator → Assessor::assess) → runtime
    /// maps Assessment → CandidateAssessment → AdmissibilityGate →
    /// CandidateEvaluator → CandidateRanking
    /// ```
    ///
    /// # The runtime adapter (design ADR-5 — the ONLY place that knows both
    /// sides of the contract)
    ///
    /// The runtime maps the frozen `Assessment` into the neutral contract:
    /// `risk = 1 − quality` (the crisp value) and the CATEGORICAL verdict
    /// `Assessment.risk == Critical → RiskAdmissibility::Rejected` — never a
    /// numeric threshold in planning; the Assessor stays the single authority
    /// on "Critical". `candidate/` never imports thalos-intelligence.
    ///
    /// Per candidate, the runtime ALSO extracts [`MotionMetrics`] (duration +
    /// path length from the analyzed trajectory, avg manipulability from the
    /// technical analysis) and builds `GateCandidate { candidate, compile_ok,
    /// assessment, metrics }` — a candidate whose compile failed has
    /// `compile_ok = false` and NO assessment (gate precedence).
    ///
    /// # Segment selection is a CALLER policy
    ///
    /// `generation_ctx.target_segment` is passed in — the runtime never
    /// invents WHICH segment to transform (design: "segment selection is a
    /// SEPARATE policy from the strategy"). The caller picks it (e.g. the
    /// problem-region segment; the demo targets the crossing segment).
    ///
    /// The existing `analyze_plan` / `analyze_plan_with_recommendations`
    /// methods are unchanged; this is additive.
    #[allow(clippy::too_many_arguments, clippy::result_large_err)]
    pub fn analyze_plan_with_candidates(
        chain: &SerialChain,
        trajectory: &thalos_core::trajectory::Trajectory,
        tcp: Option<&ToolFrame>,
        constraints: Option<&[Constraint]>,
        artifact: ArtifactRef,
        program: &PlanningProgram,
        ik_solver: &dyn thalos_core::kinematics::inverse::IKSolver,
        current_joints: &[f64],
        generation_ctx: &CandidateGenerationContext,
    ) -> Result<PlanAnalysisResult, RuntimeError> {
        // Base flow: report + recommendations (the existing contract, preserved).
        let mut result = Self::analyze_plan_with_recommendations(
            chain,
            trajectory,
            tcp,
            constraints,
            artifact.clone(),
            program,
            ik_solver,
            current_joints,
        )?;

        // 1. Generate: Direct (the seed, always candidate 0) + the bounded
        //    strategies. The runtime supplies the IK solver + ctx; the
        //    generator knows nothing about risk. The FULL strategy trace
        //    (every strategy → Generated/Skipped) is carried into the ranking
        //    (design ADR-3 observability — verify Warning 1 FIX), never dropped.
        let generator = CandidateGenerator::default();
        let (candidates, traces) = generator.generate(program, generation_ctx, ik_solver);

        let checker = NaiveCollisionChecker;
        let matrix = CollisionMatrix::new();
        let evaluator = DefaultConstraintEvaluator;
        let mut gate_candidates: Vec<GateCandidate> = Vec::with_capacity(candidates.len());

        // 2. Per candidate: compile → analyze → assess → map (ADR-5).
        for candidate in &candidates {
            let state = RobotState::new(current_joints.to_vec());
            let ctx = SegmentPlanningContext {
                robot: chain,
                current_state: &state,
                ik_solver,
                tcp,
            };
            match PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()))
                .compile(&candidate.program, &ctx)
            {
                Ok(compiled) => {
                    let mut analyzer = TrajectoryAnalyzer::new(chain, tcp)
                        .with_collision_checker(&checker, &matrix);
                    if let Some(c) = constraints {
                        analyzer = analyzer.with_constraints(c, &evaluator);
                    }
                    let (analysis, observations) = analyzer
                        .analyze_with_observations(artifact.clone(), &compiled.merged_trajectory)?;
                    let report = DefaultAggregator::new(DefaultScoringPolicy)
                        .aggregate_with_metrics(
                            artifact.clone(),
                            observations,
                            analysis.metrics.to_btree_map(),
                        );
                    let assessment = thalos_intelligence::Assessor::assess(&report);

                    gate_candidates.push(GateCandidate {
                        candidate: candidate.clone(),
                        compile_ok: true,
                        assessment: Some(CandidateAssessment {
                            risk: 1.0 - assessment.quality,
                            admissibility: match assessment.risk {
                                Risk::Critical => RiskAdmissibility::Rejected,
                                _ => RiskAdmissibility::Accepted,
                            },
                        }),
                        metrics: Some(extract_motion_metrics(
                            &compiled.merged_trajectory,
                            &analysis,
                        )),
                    });
                }
                // Compile failure → compile_ok = false and NO assessment
                // (gate precedence: phase 1 rejects before any risk policy).
                Err(_) => gate_candidates.push(GateCandidate {
                    candidate: candidate.clone(),
                    compile_ok: false,
                    assessment: None,
                    metrics: None,
                }),
            }
        }

        // 3. Two-phase gate (geometric invariants + risk policy) against the
        //    seed, with the chain's joint bounds (defense-in-depth).
        let bounds = joint_bounds_from_chain(chain);
        let gate = AdmissibilityGate.filter(program, &gate_candidates, Some(&bounds));

        // 4. Rank argmin J over the admissible set only. The ranking carries
        //    the full strategy trace (ADR-3) — the consumer never has to
        //    re-derive WHY a strategy produced no candidate.
        let ranking =
            CandidateEvaluator::evaluate(&gate.admissible, ObjectiveProfile::SafetyFirst, traces);
        result.candidate_ranking = Some(ranking);

        Ok(result)
    }
}

/// The runtime's [`MotionMetrics`] extraction (design ADR-5): duration and
/// path length from the analyzed trajectory, avg manipulability from the
/// technical analysis — the evaluator NEVER computes a metric from the
/// program (Analyzer → metrics, Evaluator → objective).
fn extract_motion_metrics(
    trajectory: &thalos_core::trajectory::Trajectory,
    analysis: &PlanAnalysis,
) -> MotionMetrics {
    MotionMetrics {
        duration: trajectory.duration(),
        avg_manipulability: analysis.metrics.avg_manipulability.unwrap_or(0.0),
        // Sum of L2 joint-space distances between consecutive waypoints
        // (same convention as the runtime's telemetry `TraceAnalyzer`).
        path_length: trajectory
            .waypoints()
            .windows(2)
            .map(|w| {
                w[1].joints()
                    .iter()
                    .zip(w[0].joints().iter())
                    .map(|(a, b)| (a - b).powi(2))
                    .sum::<f64>()
                    .sqrt()
            })
            .sum(),
    }
}

/// Per-joint closed bounds `[lower, upper]` from the chain's actuated joints
/// (limits.enabled gates the interval; unlimited joints degrade to ±π — same
/// convention as the API's optimize handler).
fn joint_bounds_from_chain(chain: &SerialChain) -> Vec<JointBounds> {
    chain
        .segments
        .iter()
        .filter(|s| s.joint.dof() > 0)
        .map(|s| {
            let limits = s.joint.limits();
            if limits.enabled {
                JointBounds {
                    lower: limits.min,
                    upper: limits.max,
                }
            } else {
                JointBounds {
                    lower: -std::f64::consts::PI,
                    upper: std::f64::consts::PI,
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::{
        ids::{MotionPlanId, OperationId},
        kinematics::inverse::DampedLeastSquaresSolver,
        models::{RobotModel, RobotRegistry},
        motion::segment::MotionSegment,
        trajectory::{Trajectory, TrajectoryPoint},
    };
    use thalos_planning::candidate::{
        CandidateGenerationContext, NoCandidateReason, SelectionReason, StrategyKind,
        StrategyOutcome,
    };
    use thalos_planning::motion::{
        compiler::{DefaultPlannerDispatcher, PlanCompiler},
        planner::SegmentPlanningContext,
        program::PlanningProgram,
    };

    fn analyze(trajectory: Trajectory) -> PlanAnalysisResult {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        PlanAnalysisService::analyze_plan(
            &chain,
            &trajectory,
            None,
            None,
            ArtifactRef::MotionPlan(MotionPlanId("mp-1".to_string())),
        )
        .expect("analyze_plan must succeed")
    }

    #[test]
    fn analyze_plan_populates_report_metrics() {
        // Spec motion-plan-endpoint "Metrics populated": after analyzing a
        // real trajectory, `report.metrics` is NOT `{}` and carries the
        // technical aggregates (waypoint_count, avg manipulability, …).
        let result = analyze(Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 1.57], 0.5),
        ]));

        assert!(
            !result.report.metrics.is_empty(),
            "report.metrics must not be empty after analysis"
        );
        assert_eq!(result.report.metrics["waypoint_count"], 2.0);

        // Fidelity: the report metrics mirror the technical analysis.
        let expected_avg = result
            .analysis
            .metrics
            .avg_manipulability
            .expect("avg manipulability computed");
        assert!(
            (result.report.metrics["avg_manipulability"] - expected_avg).abs() < 1e-12,
            "report metrics must mirror analysis.metrics"
        );
    }

    #[test]
    fn analyze_plan_metrics_match_technical_analysis_for_singular_plan() {
        // Triangulation: a singular trajectory (fully extended arm) — the
        // singular counts and min manipulability ride into the report verbatim.
        let result = analyze(Trajectory::new(vec![TrajectoryPoint::new(
            vec![0.0, 0.0],
            0.0,
        )]));

        let technical = &result.analysis.metrics;
        assert_eq!(
            result.report.metrics["waypoint_count"],
            technical.waypoint_count as f64
        );
        assert!(
            result.report.metrics["singular_count"] + result.report.metrics["near_singular_count"]
                >= 1.0,
            "fully extended arm must be (near-)singular in report metrics"
        );
        if let Some(min) = technical.min_manipulability {
            assert!(
                (result.report.metrics["min_manipulability"] - min).abs() < 1e-12,
                "min manipulability must be projected verbatim"
            );
        }
        assert!(
            result.report.metrics.contains_key("has_collisions"),
            "has_collisions is a stable aggregate key"
        );
    }

    #[test]
    fn analyze_plan_populates_assessment() {
        // Spec intelligent-assessment: the runtime composes `Assessor::assess`
        // as a final pure step — `PlanAnalysisResult.assessment` is populated
        // with a coherent risk/quality verdict and an ordered trace.
        let result = analyze(Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 1.57], 0.5),
        ]));

        // The verdict is always well-formed for a real analyzed plan.
        assert!(
            (0.0..=1.0).contains(&result.assessment.quality),
            "assessment quality must be within [0, 1], got {}",
            result.assessment.quality
        );
        // The report metrics that drive the assessment were populated first,
        // so the evidence reflects the analyzed plan.
        assert_eq!(
            result.assessment.evidence["manipulability"],
            result.report.metrics["avg_manipulability"]
        );
        // The trace exposes the exact firing order (non-empty for a real plan).
        assert!(
            !result.assessment.trace.is_empty(),
            "assessment trace must list fired rules"
        );
    }

    // ── PR3 — 4.1/4.2: analyze_plan_with_candidates ──────────────────────

    /// The crossing seed: home → cross (q1 passes through 0 → full-extension
    /// singularity event) → same-side goal. The crossing is a MIDDLE segment
    /// so the strategy can transform it without touching the joint goal (the
    /// gate's endpoint invariant compares the LAST MoveJ target).
    fn crossing_program() -> PlanningProgram {
        PlanningProgram::new(vec![
            MotionSegment::MoveJ {
                origin: OperationId("op-home".to_string()),
                target: vec![0.0, -1.31, -0.1, 0.0],
                max_velocity: None,
                max_acceleration: None,
            },
            MotionSegment::MoveJ {
                origin: OperationId("op-cross".to_string()),
                target: vec![0.5, 0.6, -0.15, 0.0],
                max_velocity: None,
                max_acceleration: None,
            },
            MotionSegment::MoveJ {
                origin: OperationId("op-goal".to_string()),
                target: vec![0.5, -1.31, -0.15, 0.0],
                max_velocity: None,
                max_acceleration: None,
            },
        ])
    }

    /// Compile a program from `home` with the real Scara chain + solver —
    /// the same deterministic compile the service does internally.
    fn compile_from(
        chain: &thalos_core::robot::serial_chain::SerialChain,
        home: &[f64],
        program: &PlanningProgram,
    ) -> thalos_core::trajectory::Trajectory {
        let fk = thalos_core::kinematics::forward::ForwardKinematics::new(chain.clone());
        let solver = DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 500, 1e-6, 0.1);
        let state = RobotState::new(home.to_vec());
        let ctx = SegmentPlanningContext {
            robot: chain,
            current_state: &state,
            ik_solver: &solver,
            tcp: None,
        };
        PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()))
            .compile(program, &ctx)
            .expect("seed must compile")
            .merged_trajectory
    }

    #[test]
    fn analyze_plan_with_candidates_populates_candidate_ranking() {
        // PR3: the composed pipeline (generate → compile → analyze → assess →
        // map → gate → rank) must populate `candidate_ranking` on the result
        // when program + solver are available. The Direct baseline (the seed
        // itself) must be ranked, and the mapping must be faithful: the
        // Direct candidate's neutral risk equals the seed's crisp risk.
        let chain = RobotRegistry::create_default(RobotModel::Scara);
        let home = vec![0.0, -1.31, -0.1, 0.0];
        let program = crossing_program();
        let trajectory = compile_from(&chain, &home, &program);

        let fk = thalos_core::kinematics::forward::ForwardKinematics::new(chain.clone());
        let solver = DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 500, 1e-6, 0.1);

        let result = PlanAnalysisService::analyze_plan_with_candidates(
            &chain,
            &trajectory,
            None,
            None,
            ArtifactRef::MotionPlan(MotionPlanId("mp-cand".to_string())),
            &program,
            &solver,
            &home,
            &CandidateGenerationContext { target_segment: 1 },
        )
        .expect("analyze_plan_with_candidates must succeed");

        let ranking = result
            .candidate_ranking
            .expect("candidate_ranking must be populated by the candidates flow");

        // The Direct baseline is ranked (candidate 0 in the runtime flow).
        let direct = ranking
            .ranked
            .iter()
            .find(|(c, _)| c.strategy == StrategyKind::Direct)
            .expect("the Direct baseline must be ranked");
        // The runtime mapping is faithful: neutral risk = 1 − quality.
        let seed_crisp = 1.0 - result.assessment.quality;
        assert!(
            (direct.1.risk - seed_crisp).abs() < 1e-9,
            "Direct neutral risk {:.6} must mirror the seed crisp risk {:.6}",
            direct.1.risk,
            seed_crisp
        );
        // The ranking is complete: a selected candidate or a structural
        // no-selection reason (never a panic).
        match &ranking.reason {
            SelectionReason::Selected { .. } => {
                assert!(
                    ranking.selected.is_some(),
                    "a Selected reason must carry the selected candidate"
                );
            }
            SelectionReason::NoAdmissibleCandidate { .. } => {
                assert!(
                    ranking.selected.is_none(),
                    "no-admissible reason must carry no selection"
                );
            }
        }

        // REMEDIATION (verify Warning 1 FIX, ADR-3 observability): the runtime
        // must NOT drop the strategy trace — the ranking carries it so the DTO
        // can surface every `Generated`/`Skipped(reason)` to the consumer.
        // The crossing seed is all-MoveJ: InsertWaypoint skips MoveJ targets
        // (`UnsupportedSegment`) and AlternateElbow re-solves the middle
        // segment to the same-side elbow posture (`Generated`).
        assert_eq!(
            ranking.strategy_trace.len(),
            3,
            "the trace must cover Direct + the two generating strategies"
        );
        assert_eq!(
            ranking.strategy_trace[0].strategy,
            StrategyKind::Direct,
            "the baseline is always the first trace row"
        );
        assert!(matches!(
            ranking.strategy_trace[0].outcome,
            StrategyOutcome::Generated(_)
        ));
        assert_eq!(
            ranking.strategy_trace[1].strategy,
            StrategyKind::InsertWaypoint
        );
        assert!(matches!(
            ranking.strategy_trace[1].outcome,
            StrategyOutcome::Skipped(NoCandidateReason::UnsupportedSegment)
        ));
        assert_eq!(
            ranking.strategy_trace[2].strategy,
            StrategyKind::AlternateElbow
        );
        assert!(matches!(
            ranking.strategy_trace[2].outcome,
            StrategyOutcome::Generated(_)
        ));
    }

    #[test]
    fn plain_analyze_plan_leaves_candidate_ranking_none() {
        // Triangulation: `candidate_ranking` is Option — the plain analysis
        // flow (no program/solver context) must leave it `None`, so the wire
        // (additive serde field) is untouched for existing callers.
        let result = analyze(Trajectory::new(vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![0.5, 1.57], 0.5),
        ]));

        assert!(
            result.candidate_ranking.is_none(),
            "plain analyze_plan must NOT populate candidate_ranking"
        );
    }

    // ── PR4 — baseline equivalence (reviewer requirement) ────────────────
    //
    // Approval test: the existing path (`analyze_plan`) and the candidates
    // path (`analyze_plan_with_candidates`) MUST agree on the SEED. For the
    // same seed program + same context, the Direct candidate's Assessment
    // MUST equal the existing path's Assessment (risk, quality, evidence,
    // trace) and the main analysis report MUST be unchanged — proving the
    // alternatives mechanism did NOT change the normal path.
    //
    // The full `Assessment` and `AnalysisReport` derive `PartialEq`, so the
    // comparison is STRUCTURAL (every field), not a sampled subset.

    #[test]
    fn candidates_flow_preserves_the_seed_assessment_and_report() {
        let chain = RobotRegistry::create_default(RobotModel::Scara);
        let home = vec![0.0, -1.31, -0.1, 0.0];
        let program = crossing_program();
        let trajectory = compile_from(&chain, &home, &program);
        let fk = thalos_core::kinematics::forward::ForwardKinematics::new(chain.clone());
        let solver = DampedLeastSquaresSolver::new(fk, *chain.end_effector(), 500, 1e-6, 0.1);
        // The SAME artifact anchor for both calls — observation/action ids are
        // reassigned deterministically by the aggregator, so an equal anchor
        // makes the whole report structurally comparable.
        let artifact = ArtifactRef::MotionPlan(MotionPlanId("mp-equiv".to_string()));

        let plain =
            PlanAnalysisService::analyze_plan(&chain, &trajectory, None, None, artifact.clone())
                .expect("analyze_plan must succeed");
        let with_candidates = PlanAnalysisService::analyze_plan_with_candidates(
            &chain,
            &trajectory,
            None,
            None,
            artifact.clone(),
            &program,
            &solver,
            &home,
            &CandidateGenerationContext { target_segment: 1 },
        )
        .expect("analyze_plan_with_candidates must succeed");

        // 1. The seed's full Assessment is byte-identical: `risk`, `quality`,
        //    `triggered_rules`, `evidence`, `recommendations`, `trace` —
        //    structural PartialEq over the whole struct.
        assert_eq!(
            with_candidates.assessment, plain.assessment,
            "the candidates flow MUST NOT change the seed assessment \
             (risk/quality/evidence/trace must be identical)"
        );

        // 2. The main analysis report is byte-identical: observations
        //    (evidence), metrics, actions, summary — structural PartialEq.
        assert_eq!(
            with_candidates.report, plain.report,
            "the candidates flow MUST NOT change the main analysis report"
        );

        // 3. The Direct candidate's OWN assessment — computed through the
        //    per-candidate pipeline (compile → analyze → assess → map) — MUST
        //    equal the plain path's assessment. Direct IS the seed program;
        //    its neutral risk is `1 − quality` of the same report the plain
        //    path assessed.
        let ranking = with_candidates
            .candidate_ranking
            .as_ref()
            .expect("the candidates flow must populate the ranking");
        let direct = ranking
            .ranked
            .iter()
            .find(|(c, _)| c.strategy == StrategyKind::Direct)
            .expect("the Direct baseline must be ranked");
        let plain_crisp = 1.0 - plain.assessment.quality;
        assert!(
            (direct.1.risk - plain_crisp).abs() < 1e-9,
            "the Direct candidate's neutral risk {:.6} MUST equal the plain \
             path's crisp risk {:.6}",
            direct.1.risk,
            plain_crisp
        );

        // 4. The additive contract is directional: the plain path must NOT
        //    gain a ranking (the wire stays untouched for old callers).
        assert!(
            plain.candidate_ranking.is_none(),
            "the plain path must not carry a candidate ranking"
        );

        // NOT compared by design: `recommendations` — the candidates flow
        // populates them (it runs `analyze_plan_with_recommendations`), the
        // plain flow returns `Vec::new()` (it has no program/solver context).
        // That is the existing PR2 contract, not a regression.
    }
}
