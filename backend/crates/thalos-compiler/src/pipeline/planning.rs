//! Planning stage — maps IR operations to planned operations and selects
//! execution strategies based on analysis results.
//!
//! Strategy selection — the decision of how to execute each operation — belongs
//! here, not in analysis.

use std::time::Duration;

use crate::ir::{IrOperation, IrProgram};
use super::analysis::{AnalysisResult, ConstraintSet};
use super::CompilationOptions;
use thalos_document::diagnostic::Diagnostic;
use thalos_document::id::OperationId;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Marker type for the planning stage.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanningStage;

/// The final output of the compilation pipeline — a sequence of planned
/// operations ready for backend-specific lowering.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedProgram {
    /// Ordered planned operations, one per post-policy IR operation.
    pub operations: Vec<PlannedOperation>,
    /// Bound constraints from the analysis stage.
    pub constraints: ConstraintSet,
    /// Pipeline execution metadata.
    pub metadata: PlanMetadata,
}

/// A single planned operation — the result of mapping one `IrOperation`
/// through strategy selection.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedOperation {
    /// The originating IR operation's `OperationId` for traceability.
    pub origin: OperationId,
    /// A human-readable label describing the kind of operation
    /// (e.g. `"home"`, `"move_to"`, `"follow"`, `"wait"`, `"set_output"`).
    pub kind: String,
}

/// Pipeline version identifier.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    /// Major version — bumped for breaking pipeline changes.
    pub major: u16,
    /// Minor version — bumped for backwards-compatible additions.
    pub minor: u16,
}

/// Execution metadata recorded by `run_pipeline`.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanMetadata {
    /// Version of the pipeline that produced this program.
    pub pipeline_version: Version,
    /// Wall-clock time for the full pipeline execution.
    pub execution_time: Duration,
    /// Options passed to the pipeline.
    pub compilation_options: CompilationOptions,
    /// Complete diagnostics from all stages.
    pub diagnostics: Vec<Diagnostic>,
    /// Per-stage completion status.
    pub stage_status: Vec<StageResult>,
}

/// Identifies which pipeline stage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PipelineStage {
    /// Policy decision stage.
    Policy,
    /// Constraint analysis stage.
    Analysis,
    /// Operation planning stage.
    Planning,
}

/// Completion status for a single pipeline stage.
#[derive(Debug, Clone, PartialEq)]
pub enum StageStatus {
    /// Stage completed normally.
    Success,
    /// Stage was skipped (e.g. due to a prior abort).
    Skipped,
    /// Stage failed with a human-readable reason.
    Failed(String),
}

/// Duration and status for a single pipeline stage.
#[derive(Debug, Clone, PartialEq)]
pub struct StageResult {
    /// Which stage this result describes.
    pub stage: PipelineStage,
    /// How the stage completed.
    pub status: StageStatus,
    /// Wall-clock duration for this stage.
    pub duration: Duration,
}

impl StageResult {
    /// Create a new stage result.
    pub fn new(stage: PipelineStage, status: StageStatus, duration: Duration) -> Self {
        Self {
            stage,
            status,
            duration,
        }
    }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/// Run the planning stage — map each IR operation to a `PlannedOperation`.
///
/// Returns exactly `N` operations for `N` input IR operations, preserving
/// order. Strategy selection logic will be expanded in future iterations.
pub fn execute(
    ir: &IrProgram,
    _analysis: &AnalysisResult,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<PlannedOperation> {
    PlanningStage::execute(ir, _analysis, diagnostics)
}

impl PlanningStage {
    /// Execute the planning stage — map each IR operation to a planned
    /// operation.
    ///
    /// Each `IrOperation` maps to exactly one `PlannedOperation`. The
    /// `_analysis` result is reserved for future strategy selection.
    pub fn execute(
        ir: &IrProgram,
        _analysis: &AnalysisResult,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Vec<PlannedOperation> {
        for op in &ir.operations {
            diagnostics.push(Diagnostic::warning(
                "planning",
                format!("planned operation {}", op_to_planned(op).origin),
                "pipeline",
            ));
        }

        ir.operations
            .iter()
            .map(op_to_planned)
            .collect()
    }
}

/// Map a single `IrOperation` to a `PlannedOperation`.
fn op_to_planned(op: &IrOperation) -> PlannedOperation {
    let (origin, kind) = match op {
        IrOperation::Home { origin } => (origin.clone(), "home"),
        IrOperation::MoveTo { origin, .. } => (origin.clone(), "move_to"),
        IrOperation::Follow { origin, .. } => (origin.clone(), "follow"),
        IrOperation::Wait { origin, .. } => (origin.clone(), "wait"),
        IrOperation::SetOutput { origin, .. } => (origin.clone(), "set_output"),
    };
    PlannedOperation {
        origin,
        kind: kind.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{IrOperation, IrProgram};
    use std::time::Duration;
    use thalos_document::diagnostic::Diagnostic;
    use thalos_document::id::OperationId;
    use thalos_document::project::Metadata as ProjectMetadata;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fn make_ir(operations: Vec<IrOperation>) -> IrProgram {
        IrProgram {
            version: 1,
            operations,
            source_metadata: ProjectMetadata {
                name: "test".into(),
                version: 1,
                created_at: "".into(),
                modified_at: "".into(),
            },
        }
    }

    fn make_analysis_result(items: Vec<&str>) -> AnalysisResult {
        AnalysisResult {
            constraints: ConstraintSet {
                items: items.iter().map(|s| s.to_string()).collect(),
            },
        }
    }

    // ------------------------------------------------------------------
    // 2.6 — Structural: type construction, field assertions
    // ------------------------------------------------------------------

    #[test]
    fn version_construction() {
        let v = Version {
            major: 0,
            minor: 1,
        };
        assert_eq!(v.major, 0);
        assert_eq!(v.minor, 1);
    }

    #[test]
    fn planned_operation_construction() {
        let op = PlannedOperation {
            origin: OperationId("op_01".into()),
            kind: "home".into(),
        };
        assert_eq!(op.origin.as_str(), "op_01");
        assert_eq!(op.kind, "home");
    }

    #[test]
    fn planned_program_construction() {
        let ops = vec![PlannedOperation {
            origin: OperationId("op_01".into()),
            kind: "home".into(),
        }];
        let constraints = ConstraintSet { items: vec![] };
        let metadata = PlanMetadata {
            pipeline_version: Version {
                major: 0,
                minor: 1,
            },
            execution_time: Duration::ZERO,
            compilation_options: CompilationOptions {
                policy_mode: super::super::PolicyMode::Strict,
            },
            diagnostics: vec![],
            stage_status: vec![],
        };
        let program = PlannedProgram {
            operations: ops.clone(),
            constraints,
            metadata,
        };
        assert_eq!(program.operations.len(), 1);
        assert_eq!(program.operations[0].kind, "home");
    }

    #[test]
    fn stage_result_construction() {
        let sr = StageResult::new(
            PipelineStage::Policy,
            StageStatus::Success,
            Duration::from_millis(5),
        );
        assert_eq!(sr.stage, PipelineStage::Policy);
        assert_eq!(sr.status, StageStatus::Success);
        let _ = sr.duration; // Duration is always non-negative by construction.
    }

    #[test]
    fn stage_result_failed_contains_reason() {
        let sr = StageResult::new(
            PipelineStage::Analysis,
            StageStatus::Failed("singularity detected".into()),
            Duration::ZERO,
        );
        match sr.status {
            StageStatus::Failed(ref reason) => {
                assert!(reason.contains("singularity"));
            }
            _ => panic!("Expected Failed variant"),
        }
    }

    #[test]
    fn stage_status_variants_are_distinct() {
        let success = StageStatus::Success;
        let skipped = StageStatus::Skipped;
        let failed = StageStatus::Failed("err".into());
        assert_ne!(format!("{success:?}"), format!("{skipped:?}"));
        assert_ne!(format!("{success:?}"), format!("{failed:?}"));
    }

    #[test]
    fn pipeline_stage_variants_are_distinct() {
        assert_ne!(
            format!("{:?}", PipelineStage::Policy),
            format!("{:?}", PipelineStage::Analysis)
        );
        assert_ne!(
            format!("{:?}", PipelineStage::Policy),
            format!("{:?}", PipelineStage::Planning)
        );
    }

    // ------------------------------------------------------------------
    // 2.6 — Behavioral: one-to-one ops mapping, metadata construction
    // ------------------------------------------------------------------

    #[test]
    fn planning_one_to_one_mapping() {
        let ir = make_ir(vec![
            IrOperation::Home {
                origin: OperationId("op_01".into()),
            },
            IrOperation::Wait {
                origin: OperationId("op_02".into()),
                duration: Duration::from_secs(1),
            },
        ]);
        let analysis = make_analysis_result(vec!["op_01:home", "op_02:wait"]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);

        assert_eq!(
            ops.len(),
            2,
            "must produce exactly N operations for N IR operations"
        );
    }

    #[test]
    fn planning_preserves_operation_order() {
        let ir = make_ir(vec![
            IrOperation::Home {
                origin: OperationId("op_01".into()),
            },
            IrOperation::MoveTo {
                origin: OperationId("op_02".into()),
                pose: crate::ir::ResolvedPose {
                    position: [0.0; 3],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: crate::ir::ResolvedFrame {
                        name: "base".into(),
                        parent: "world".into(),
                        transform: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                    },
                },
                profile: crate::ir::ResolvedProfile {
                    name: "default".into(),
                    velocity: 1.0,
                    acceleration: 2.0,
                },
            },
            IrOperation::Wait {
                origin: OperationId("op_03".into()),
                duration: Duration::from_millis(500),
            },
        ]);
        let analysis = make_analysis_result(vec![]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);

        assert_eq!(ops.len(), 3);
        assert_eq!(ops[0].origin.as_str(), "op_01");
        assert_eq!(ops[1].origin.as_str(), "op_02");
        assert_eq!(ops[2].origin.as_str(), "op_03");
        assert_eq!(ops[0].kind, "home");
        assert_eq!(ops[1].kind, "move_to");
        assert_eq!(ops[2].kind, "wait");
    }

    #[test]
    fn planning_empty_ir_produces_empty_ops() {
        let ir = make_ir(vec![]);
        let analysis = make_analysis_result(vec![]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);
        assert!(
            ops.is_empty(),
            "empty IR should produce zero planned operations"
        );
    }

    #[test]
    fn planning_maps_all_ir_variants() {
        let ir = make_ir(vec![
            IrOperation::Home {
                origin: OperationId("op_01".into()),
            },
            IrOperation::MoveTo {
                origin: OperationId("op_02".into()),
                pose: crate::ir::ResolvedPose {
                    position: [0.0; 3],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: crate::ir::ResolvedFrame {
                        name: "base".into(),
                        parent: "world".into(),
                        transform: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                    },
                },
                profile: crate::ir::ResolvedProfile {
                    name: "default".into(),
                    velocity: 1.0,
                    acceleration: 2.0,
                },
            },
            IrOperation::Follow {
                origin: OperationId("op_03".into()),
                waypoints: vec![crate::ir::ResolvedPose {
                    position: [0.0; 3],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: crate::ir::ResolvedFrame {
                        name: "base".into(),
                        parent: "world".into(),
                        transform: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                    },
                }],
                profile: crate::ir::ResolvedProfile {
                    name: "default".into(),
                    velocity: 1.0,
                    acceleration: 2.0,
                },
            },
            IrOperation::Wait {
                origin: OperationId("op_04".into()),
                duration: Duration::from_secs(2),
            },
            IrOperation::SetOutput {
                origin: OperationId("op_05".into()),
                channel: crate::ir::ResolvedOutput {
                    name: "Gripper".into(),
                    channel_type: "digital".into(),
                },
                value: thalos_document::operation::io::OutputValue::Bool(true),
            },
        ]);
        let analysis = make_analysis_result(vec![]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);

        assert_eq!(ops.len(), 5);
        assert_eq!(ops[0].kind, "home");
        assert_eq!(ops[1].kind, "move_to");
        assert_eq!(ops[2].kind, "follow");
        assert_eq!(ops[3].kind, "wait");
        assert_eq!(ops[4].kind, "set_output");
    }

    #[test]
    fn metadata_construction() {
        let meta = PlanMetadata {
            pipeline_version: Version {
                major: 0,
                minor: 1,
            },
            execution_time: Duration::from_millis(42),
            compilation_options: CompilationOptions {
                policy_mode: super::super::PolicyMode::Strict,
            },
            diagnostics: vec![Diagnostic::warning("W001", "test warning", "pipeline")],
            stage_status: vec![StageResult::new(
                PipelineStage::Policy,
                StageStatus::Success,
                Duration::from_millis(5),
            )],
        };
        assert_eq!(meta.pipeline_version.major, 0);
        assert_eq!(meta.execution_time.as_millis(), 42);
        assert_eq!(meta.diagnostics.len(), 1);
        assert_eq!(meta.stage_status.len(), 1);
    }

    // ------------------------------------------------------------------
    // Clone + Debug hygiene
    // ------------------------------------------------------------------

    #[test]
    fn plan_metadata_is_clone_and_debug() {
        let a = PlanMetadata {
            pipeline_version: Version {
                major: 0,
                minor: 1,
            },
            execution_time: Duration::ZERO,
            compilation_options: CompilationOptions {
                policy_mode: super::super::PolicyMode::Strict,
            },
            diagnostics: vec![],
            stage_status: vec![],
        };
        let _b = a.clone();
        let _ = format!("{a:?}");
    }

    #[test]
    fn planning_stage_is_clone_and_debug() {
        let s = PlanningStage;
        let _b = s.clone();
        let _ = format!("{s:?}");
    }
}
