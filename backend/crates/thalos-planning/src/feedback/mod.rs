//! Execution feedback types for the planning feedback loop.
//!
//! This module introduces observation types from execution traces,
//! intention operators for transforming motion segments, and an
//! orchestrator that coordinates the full feedback cycle.
//!
//! ## Layering
//!
//! - `finding` — trace summary types (`TraceSnapshot`/`SegmentTrace`) for the
//!   `Verdict` comparison; the legacy execution-finding vocabulary was removed
//!   in the phase-6 deletion (tasks.md 6.1)
//! - `operator` — transformation layer (PR 2): applies intention operators
//! - `orchestrator` — coordination layer (PR 3): full feedback cycle
//! - `materializer` — remediation layer (PR 4d): proposal → plan modifications

pub mod finding;
pub mod materializer;
pub mod operator;
pub mod operators;
pub mod orchestrator;
