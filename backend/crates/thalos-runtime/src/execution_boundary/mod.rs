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
//!
//! # Modules
//!
//! | Module | Contents | Phase |
//! |--------|----------|-------|
//! | `adapter` | `ExecutionAdapter` — existing plan→command translation | — |
//! | `command` | `ExecutionCommand`, `ExecutionSegmentBoundary` | — |
//! | `manifest` | `ExecutionManifest`, `ManifestMetadata`, `ManifestSegment`, `ManifestInstruction`, `TimedWaypoint` | PR 1 |
//! | `manifest_builder` | `ExecutionManifestBuilder`, `ManifestError` | PR 1 |
//! | `report` | `ExecutionReport`, `ExecutionError`, `ExecutionStatus` | — |
//! | `sample` | `ExecutionSample` | PR 1 |
//! | `trace_assembler` | `assemble_trace()` free function | PR 1 |

pub mod adapter;
pub mod command;
pub mod manifest;
pub mod manifest_builder;
pub mod report;
pub mod sample;
pub mod trace_assembler;

pub use adapter::ExecutionAdapter;
pub use command::{ExecutionCommand, ExecutionSegmentBoundary};
pub use manifest::{
    ExecutionManifest, ManifestInstruction, ManifestMetadata, ManifestSegment, TimedWaypoint,
};
pub use manifest_builder::{ExecutionManifestBuilder, ManifestError};
pub use report::{ExecutionError, ExecutionReport, ExecutionStatus};
pub use sample::ExecutionSample;
pub use trace_assembler::assemble_trace;
