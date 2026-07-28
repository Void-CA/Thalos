//! Execution Validation Boundary — adapter between `ExecutionPlan` and `RobotController`.
//!
//! This module translates planning-side execution plans into commands consumable
//! by the runtime's `RobotController` trait, preserving segment metadata so that
//! downstream analysis (SDD-006) can compare planned vs. actual execution.
//!
//! # Ownership
//!
//! Lives in `thalos-runtime` because runtime already depends on `thalos-planning`
//! and owns `RobotController`. The reverse direction would create a circular dep.

pub mod adapter;
pub mod command;
pub mod report;

pub use adapter::ExecutionAdapter;
pub use command::{ExecutionCommand, ExecutionSegmentBoundary};
pub use report::{ExecutionError, ExecutionReport, ExecutionStatus};
