//! Modelo de evaluación de planes — métricas, función de costo y scoring.
//!
//! Separa el **qué medir** (`PlanMetrics`) del **cómo ponderarlo** (`CostFunction`).
//! El evaluador (`PlanEvaluator`) convierte análisis existentes en puntajes comparables.

pub mod metrics;
pub mod cost;
pub mod evaluator;

pub use metrics::{
    CollisionMetrics, JointSafetyMetrics, ManipulabilityMetrics, MetricKind, PlanMetrics,
};
pub use cost::{CostFunction, PlanScore};
pub use evaluator::PlanEvaluator;
