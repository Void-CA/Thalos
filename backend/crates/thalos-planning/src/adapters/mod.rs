//! Adapters from legacy planning types to the new trait contracts.
//!
//! These adapters bridge the `thalos-planning` domain types (e.g.
//! `RepairStrategy`) to the `thalos-optimization` trait interfaces
//! (e.g. `TrajectoryOperator`), enabling gradual migration without
//! breaking existing code.

pub mod repair_strategy_adapter;

pub use repair_strategy_adapter::RepairStrategyAdapter;
