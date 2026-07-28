use std::ops::Range;

use thalos_core::trajectory::Trajectory;

use crate::analysis::domain::{ProblemRegion, RegionId};
use crate::evaluation::metrics::PlanMetrics;
use crate::motion::program::CompiledPlan;

/// Intención de una estrategia de reparación.
///
/// Cada variante representa una *intención*, no una configuración.
/// Los parámetros concretos pertenecen a la implementación de la estrategia.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StrategyKind {
    LiftTcp,
    RotateTool,
    SwitchIkBranch,
    SmoothOrientation,
    SplitSegment,
}

impl StrategyKind {
    /// Representación estable en kebab-case.
    pub fn name(&self) -> &'static str {
        match self {
            StrategyKind::LiftTcp => "lift-tcp",
            StrategyKind::RotateTool => "rotate-tool",
            StrategyKind::SwitchIkBranch => "switch-ik-branch",
            StrategyKind::SmoothOrientation => "smooth-orientation",
            StrategyKind::SplitSegment => "split-segment",
        }
    }
}

/// Cambio aplicado a un plan existente.
///
/// # Invariantes
/// - `region_id` MUST reference an existing `ProblemRegion`
/// - `waypoint_range` MUST be a valid range within the original `CompiledPlan`
/// - `replacement` SHOULD have the same number of waypoints as the original range
#[derive(Debug, Clone)]
pub struct PlanDelta {
    /// Región que se está reparando.
    pub region_id: RegionId,
    /// Rango de waypoints a reemplazar en el plan original.
    pub waypoint_range: Range<usize>,
    /// Nuevos puntos de trayectoria para el rango.
    pub replacement: Trajectory,
}

impl PlanDelta {
    pub fn new(
        region_id: RegionId,
        waypoint_range: Range<usize>,
        replacement: Trajectory,
    ) -> Result<Self, RepairError> {
        if waypoint_range.start > waypoint_range.end {
            return Err(RepairError::InvalidDelta(
                "waypoint_range.start must be <= end".into(),
            ));
        }
        Ok(Self {
            region_id,
            waypoint_range,
            replacement,
        })
    }
}

/// Propuesta de reparación antes de ser evaluada.
///
/// Un candidate puede existir sin haber sido evaluado aún.
#[derive(Debug, Clone)]
pub struct RepairCandidate {
    /// Estrategia que generó este candidato.
    pub strategy: StrategyKind,
    /// Cambio propuesto respecto al plan original.
    pub delta: PlanDelta,
    /// Evaluación del candidato (None si aún no se evaluó).
    pub evaluation: Option<RepairEvaluation>,
}

impl RepairCandidate {
    pub fn new(strategy: StrategyKind, delta: PlanDelta) -> Self {
        Self {
            strategy,
            delta,
            evaluation: None,
        }
    }

    pub fn with_evaluation(mut self, evaluation: RepairEvaluation) -> Self {
        self.evaluation = Some(evaluation);
        self
    }
}

/// Resultado de evaluar un candidato contra el segmento original.
#[derive(Debug, Clone)]
pub struct RepairEvaluation {
    /// Métricas del segmento original.
    pub metrics_before: PlanMetrics,
    /// Métricas del segmento candidato.
    pub metrics_after: PlanMetrics,
    /// Diferencia de score (positivo = mejora, negativo = empeoramiento).
    pub score_delta: f64,
    /// Mejora porcentual (0.0..1.0).
    pub improvement: f64,
}

/// Resultado de aplicar una reparación al plan.
#[derive(Debug, Clone)]
pub enum RepairResult {
    /// Reparación aplicada exitosamente.
    Accepted {
        /// Plan modificado.
        plan: CompiledPlan,
        /// Evaluación de la reparación.
        evaluation: RepairEvaluation,
    },
    /// Reparación rechazada.
    Rejected {
        /// Razón del rechazo.
        reason: RepairError,
    },
}

/// Razón por la que una estrategia fue recomendada o priorizada.
#[derive(Debug, Clone, PartialEq)]
pub enum RecommendationReason {
    NearKnownSingularity,
    PreferredConfigurationNearby,
    HighReachability,
    LowReachability,
    LowManipulability,
    JointLimitProximity,
}

/// Recomendación de una estrategia con su justificación.
#[derive(Debug, Clone)]
pub struct StrategyRecommendation {
    pub strategy: StrategyKind,
    pub score: f64,
    pub reasons: Vec<RecommendationReason>,
}

/// Razones esperadas de fallo en una reparación.
#[derive(Debug, Clone)]
pub enum RepairError {
    /// IK no converge para la pose objetivo.
    IkFailure(String),
    /// El delta de reparación es inválido (rango fuera de bounds, etc.).
    InvalidDelta(String),
    /// El merge produciría una discontinuidad.
    ContinuityViolation(String),
    /// La reparación no mejora el score suficientemente.
    NoImprovement(String),
    /// La reparación viola constraints.
    ConstraintViolation(String),
}

impl std::fmt::Display for RepairError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RepairError::IkFailure(msg) => write!(f, "IK failure: {}", msg),
            RepairError::InvalidDelta(msg) => write!(f, "Invalid delta: {}", msg),
            RepairError::ContinuityViolation(msg) => write!(f, "Continuity violation: {}", msg),
            RepairError::NoImprovement(msg) => write!(f, "No improvement: {}", msg),
            RepairError::ConstraintViolation(msg) => write!(f, "Constraint violation: {}", msg),
        }
    }
}

/// Estado de un plan de reparación para una región.
#[derive(Debug, Clone, PartialEq)]
pub enum RepairPlanStatus {
    /// Estrategias aplicables generaron candidatos exitosamente.
    Available,
    /// Ninguna estrategia es aplicable a esta región.
    NoStrategyApplicable,
    /// Estrategias aplicables existieron pero todas fallaron (IK, continuidad, etc.).
    AllStrategiesFailed,
}

/// Resultado de planificar reparaciones para una región.
#[derive(Debug, Clone)]
pub struct RepairPlan {
    pub region: ProblemRegion,
    pub candidates: Vec<RepairCandidate>,
    /// Índice del candidato recomendado (None si no hay candidatos o si no se determinó).
    pub recommended: Option<usize>,
    pub status: RepairPlanStatus,
    /// Recomendaciones basadas en conocimiento (M8.3.4).
    pub recommendations: Vec<StrategyRecommendation>,
}

impl std::error::Error for RepairError {}

// ═════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::domain::{ProblemRegion, RegionId};
    use crate::evaluation::metrics::{CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics};

    fn default_metrics() -> PlanMetrics {
        PlanMetrics {
            length: 0.0,
            waypoint_count: 0,
            manipulability: ManipulabilityMetrics {
                min: 0.0,
                average: 0.0,
                near_singular_count: 0,
                singular_count: 0,
            },
            joint_safety: JointSafetyMetrics {
                min_margin: 0.0,
                avg_max_utilization: 0.0,
                violation_count: 0,
            },
            collision: CollisionMetrics {
                min_distance: f64::MAX,
                collision_count: 0,
                near_miss_count: 0,
            },
            smoothness: 0.0,
            orientation_change: 0.0,
        }
    }

    #[test]
    fn test_strategy_kind_stable_name() {
        assert_eq!(StrategyKind::LiftTcp.name(), "lift-tcp");
        assert_eq!(StrategyKind::RotateTool.name(), "rotate-tool");
        assert_eq!(StrategyKind::SwitchIkBranch.name(), "switch-ik-branch");
        assert_eq!(StrategyKind::SmoothOrientation.name(), "smooth-orientation");
        assert_eq!(StrategyKind::SplitSegment.name(), "split-segment");
    }

    #[test]
    fn test_candidate_no_evaluation() {
        let region_id = RegionId(0);
        let trajectory = Trajectory::new(vec![]);
        let delta = PlanDelta::new(region_id, 0..10, trajectory).unwrap();
        let candidate = RepairCandidate::new(StrategyKind::LiftTcp, delta);
        assert!(candidate.evaluation.is_none());
        assert_eq!(candidate.strategy, StrategyKind::LiftTcp);
    }

    #[test]
    fn test_candidate_with_evaluation() {
        let region_id = RegionId(0);
        let trajectory = Trajectory::new(vec![]);
        let delta = PlanDelta::new(region_id, 0..10, trajectory).unwrap();
        let dm = default_metrics();
        let eval = RepairEvaluation {
            metrics_before: dm.clone(),
            metrics_after: dm.clone(),
            score_delta: 0.15,
            improvement: 0.15,
        };
        let candidate = RepairCandidate::new(StrategyKind::LiftTcp, delta).with_evaluation(eval);
        assert!(candidate.evaluation.is_some());
    }

    #[test]
    fn test_result_discrimination() {
        let dm = default_metrics();
        let accept = &RepairResult::Accepted {
            plan: CompiledPlan::new(Trajectory::new(vec![]), vec![]),
            evaluation: RepairEvaluation {
                metrics_before: dm.clone(),
                metrics_after: dm.clone(),
                score_delta: 0.1,
                improvement: 0.1,
            },
        };
        let reject = &RepairResult::Rejected {
            reason: RepairError::IkFailure("no solution".into()),
        };

        match accept {
            RepairResult::Accepted { .. } => {}
            _ => panic!("Expected Accepted"),
        }
        match reject {
            RepairResult::Rejected { .. } => {}
            _ => panic!("Expected Rejected"),
        }
    }

    #[test]
    fn test_invalid_delta_rejected() {
        let region_id = RegionId(0);
        let trajectory = Trajectory::new(vec![]);
        let result = PlanDelta::new(region_id, 10..5, trajectory);
        assert!(result.is_err());
    }
}
