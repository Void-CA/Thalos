//! Servicio de análisis de trayectorias planificadas.
//!
//! Orquesta el pipeline de análisis sobre un plan activo:
//! 1. Obtiene la trayectoria desde el runtime
//! 2. Evalúa cada waypoint (FK, Jacobiano, singularidad, manipulabilidad, colisiones)
//! 3. Genera recomendaciones
//! 4. Retorna el resultado

use thalos_core::{
    analysis::constraints::{Constraint, DefaultConstraintEvaluator},
    collision::CollisionMatrix,
    robot::{serial_chain::SerialChain, tool_frame::ToolFrame},
};
use thalos_collision::NaiveCollisionChecker;
use thalos_planning::{
    analysis::{PlanAnalysis, TrajectoryAnalyzer},
    advisor::{PlanAdvisor, Recommendation},
    finding::Finding,
};

use crate::error::RuntimeError;

/// Resultado completo del análisis de un plan.
#[derive(Debug, Clone)]
pub struct PlanAnalysisResult {
    /// Análisis técnico por waypoint y métricas agregadas.
    pub analysis: PlanAnalysis,
    /// Hallazgos objetivos.
    pub findings: Vec<Finding>,
    /// Recomendaciones generadas por el Advisor a partir de findings.
    pub recommendations: Vec<Recommendation>,
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
    ///
    /// # Retorna
    ///
    /// `PlanAnalysisResult` con análisis por waypoint, métricas agregadas y recomendaciones.
    pub fn analyze_plan(
        chain: &SerialChain,
        trajectory: &thalos_core::trajectory::Trajectory,
        tcp: Option<&ToolFrame>,
        constraints: Option<&[Constraint]>,
    ) -> Result<PlanAnalysisResult, RuntimeError> {
        let checker = NaiveCollisionChecker;
        let matrix = CollisionMatrix::new();
        let evaluator = DefaultConstraintEvaluator;

        let mut analyzer = TrajectoryAnalyzer::new(chain, tcp)
            .with_collision_checker(&checker, &matrix);

        if let Some(c) = constraints {
            analyzer = analyzer.with_constraints(c, &evaluator);
        }

        let analysis = analyzer.analyze(trajectory)?;

        // El Advisor solo interpreta findings, nunca recalcula
        let advisor = PlanAdvisor;
        let findings = analysis.findings.clone();
        let recommendations = advisor.advise(&findings);

        Ok(PlanAnalysisResult {
            analysis,
            findings,
            recommendations,
        })
    }
}
