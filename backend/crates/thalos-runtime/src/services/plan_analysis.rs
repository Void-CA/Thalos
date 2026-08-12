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
use thalos_planning::{
    advisor::PlanAdvisor,
    analysis::{PlanAnalysis, TrajectoryAnalyzer},
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::{
        ids::MotionPlanId,
        models::{RobotModel, RobotRegistry},
        trajectory::{Trajectory, TrajectoryPoint},
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
}
