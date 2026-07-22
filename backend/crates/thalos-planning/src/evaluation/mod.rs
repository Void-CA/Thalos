//! Modelo de evaluación de planes — métricas, función de costo y scoring.
//!
//! Separa el **qué medir** (`PlanMetrics`) del **cómo ponderarlo** (`CostFunction`).
//! El evaluador (`PlanEvaluator`) convierte análisis existentes en puntajes comparables.

pub mod cost;
pub mod evaluator;
pub mod metrics;

pub use cost::{CostFunction, PlanScore};
pub use evaluator::PlanEvaluator;
pub use metrics::{
    CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics, MetricKind, PlanMetrics,
};

// M8.2 reemplazó AlternativeGenerator por RepairPlanner.
// M8.1 reemplazó ProblemRegions legacy por SemanticRegion analysis.
