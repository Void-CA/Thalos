//! Execution feedback types for the planning feedback loop.
//!
//! This module introduces observation types from execution traces,
//! intention operators for transforming motion segments, and an
//! orchestrator that coordinates the full feedback cycle.
//!
//! ## Layering
//!
//! - `finding` — observation layer (PR 1): analyzes traces, produces findings
//! - `operator` — transformation layer (PR 2): applies intention operators
//! - `orchestrator` — coordination layer (PR 3): full feedback cycle

pub mod finding;
pub mod operator;
pub mod operators;
