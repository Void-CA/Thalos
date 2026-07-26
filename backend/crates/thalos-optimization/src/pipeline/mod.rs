//! Pipeline module for trajectory optimization.
//!
//! Contains the operator selection and iteration logic that drives
//! the optimization process across problem regions.
//!
//! - `operator_selector` — Ranks operators by composite score for a given region
//! - `optimization_pipeline` — Iterative per-region optimization loop

pub mod operator_selector;
pub mod optimization_pipeline;

pub use optimization_pipeline::{OptimizationPipeline, OptimizationResult};
pub use operator_selector::OperatorSelector;
