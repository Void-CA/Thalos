//! Execution Validation Boundary — plan→hardware manifest and trace types.
//!
//! This module owns the types shared with the ESP32 hardware backend and the
//! trace-assembly helpers. The `ExecutionPlan`-based adapter
//! (`ExecutionAdapter::prepare/execute`) and manifest builder
//! (`ExecutionManifestBuilder::from_plan`) were removed with the parallel
//! `ExecutionPlan` path (invariant I4 — the type no longer exists); the
//! canonical trajectory output is `CompiledPlan` (IR-3).
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
//! | `manifest` | `ExecutionManifest`, `ManifestMetadata`, `ManifestSegment`, `ManifestInstruction`, `TimedWaypoint` | PR 1 |
//! | `sample` | `ExecutionSample` | PR 1 |
//! | `trace_assembler` | `assemble_trace()` free function | PR 1 |

pub mod manifest;
pub mod sample;
pub mod trace_assembler;

pub use manifest::{
    ExecutionManifest, ManifestInstruction, ManifestMetadata, ManifestSegment, TimedWaypoint,
};
pub use sample::ExecutionSample;
pub use trace_assembler::assemble_trace;
