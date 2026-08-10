//! Modelo de evaluación de planes — métricas.
//!
//! Separa el **qué medir** (`PlanMetrics`) del **cómo ponderarlo**.
//! El evaluador (`PlanEvaluator`) convierte análisis existentes en métricas.

pub mod evaluator;
pub mod metrics;

pub use evaluator::PlanEvaluator;
pub use metrics::{
    CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics, MetricKind, PlanMetrics,
};

// M8.2 reemplazó AlternativeGenerator por RepairPlanner.
// M8.1 reemplazó ProblemRegions legacy por SemanticRegion analysis.
