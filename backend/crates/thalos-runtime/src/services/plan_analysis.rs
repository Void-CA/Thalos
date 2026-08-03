//! Servicio de análisis de trayectorias planificadas.
//!
//! Orquesta el pipeline de análisis sobre un plan activo:
//! 1. Obtiene la trayectoria desde el runtime
//! 2. Evalúa cada waypoint (FK, Jacobiano, singularidad, manipulabilidad, colisiones)
//! 3. (PR 3) Emite observaciones canónicas ancladas al plan (I3) y las agrega a un
//!    [`AnalysisReport`] vía `DefaultAggregator` (D2/D3)
//! 4. (PR 3) El `PlanAdvisor` genera [`Action`]s sobre las observaciones (I5)
//! 5. Retorna el resultado (campos legacy + reporte canónico)

use thalos_collision::NaiveCollisionChecker;
use thalos_core::{
    analysis::action::Action,
    analysis::aggregator::{Aggregator, DefaultAggregator},
    analysis::constraints::{Constraint, DefaultConstraintEvaluator},
    analysis::observation::ArtifactRef,
    analysis::report::AnalysisReport,
    analysis::scoring::DefaultScoringPolicy,
    collision::CollisionMatrix,
    robot::{serial_chain::SerialChain, tool_frame::ToolFrame},
};
use thalos_planning::{
    advisor::{PlanAdvisor, Recommendation},
    analysis::adapter::FindingAdapter,
    analysis::{PlanAnalysis, TrajectoryAnalyzer},
    finding::Finding,
};

use crate::error::RuntimeError;

/// Resultado completo del análisis de un plan.
#[derive(Debug, Clone)]
pub struct PlanAnalysisResult {
    /// Análisis técnico por waypoint y métricas agregadas (camino legacy — PR 7a).
    pub analysis: PlanAnalysis,
    /// Hallazgos objetivos (camino legacy — PR 7a).
    pub findings: Vec<Finding>,
    /// Recomendaciones del Advisor sobre findings (camino legacy — PR 7a).
    pub recommendations: Vec<Recommendation>,
    /// Reporte canónico agregado (PR 3): observaciones + summary, `validate()`-safe.
    pub report: AnalysisReport,
    /// Acciones del Advisor sobre las observaciones (PR 3, I5: `target_observation`).
    pub actions: Vec<Action>,
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
    /// `PlanAnalysisResult` con análisis por waypoint, métricas agregadas,
    /// observaciones canónicas agregadas (`report`), acciones (I5) y
    /// recomendaciones legacy.
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

        // El Analyzer produce hechos (waypoints/métricas + findings legacy).
        let analysis = analyzer.analyze_plan(trajectory)?;

        // PR 3 — observaciones canónicas ancladas al artifact (I3); equivalente
        // exacto de `TrajectoryAnalyzer::analyze(artifact, trajectory)` (el
        // método canónico lo ejercitan los tests del crate planning).
        let observations = FindingAdapter.convert_all(artifact.clone(), &analysis.findings);

        // El Advisor solo interpreta observaciones, nunca recalcula (C2).
        let advisor = PlanAdvisor;
        let actions = advisor.advise(&observations);
        let findings = analysis.findings.clone();
        let recommendations = advisor.advise_findings(&findings);

        // Agregación canónica: observaciones → AnalysisReport (D3).
        let report = DefaultAggregator::new(DefaultScoringPolicy).aggregate(artifact, observations);

        Ok(PlanAnalysisResult {
            analysis,
            findings,
            recommendations,
            report,
            actions,
        })
    }
}
