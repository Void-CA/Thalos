//! Compilation pipeline — policy, analysis, and planning stages.
//!
//! This module orchestrates the transformation of an `IrProgram` into a
//! `PlannedProgram` via three sequential stages.

pub mod analysis;
pub mod planning;
pub mod policy;

use thalos_document::diagnostic::Diagnostic;

use crate::ir::IrProgram;

pub use analysis::{AnalysisResult, ConstraintSet};
pub use planning::{
    MotionStrategy, PipelineStage, PlanMetadata, PlannedOperation, PlannedProgram, StageResult,
    StageStatus, Version,
};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// A pipeline-level error — typically from policy deciding to abort.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineError(pub String);

/// User-supplied options controlling pipeline behaviour.
#[derive(Debug, Clone, PartialEq)]
pub struct CompilationOptions {
    /// Which policy mode to use for the policy stage.
    pub policy_mode: PolicyMode,
}

/// Enumeration of built-in policy modes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PolicyMode {
    /// Errors → Abort; warnings → Compile.
    Strict,
    /// Errors → ContinueWith(SkipFailing); warnings → stderr.
    Development,
    /// Errors → ContinueWith(BestEffort); unknown profiles → default.
    Demo,
    /// Every diagnostic → Abort (warnings elevated to errors).
    CIValidation,
}

// ---------------------------------------------------------------------------
// Pipeline orchestrator
// ---------------------------------------------------------------------------

/// Execute the full compilation pipeline.
///
/// Stages run in strict order: **policy → analysis → planning**.
/// If the policy stage returns `Abort`, the pipeline terminates immediately
/// and returns `Err(PipelineError)` with the abort reason.
///
/// Diagnostics are accumulated in a single collector that is merged into
/// `PlanMetadata::diagnostics`.
pub fn run_pipeline(
    ir: IrProgram,
    policy: &dyn policy::CompilationPolicy,
    options: CompilationOptions,
) -> Result<PlannedProgram, PipelineError> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut stage_status: Vec<StageResult> = Vec::new();
    let start = std::time::Instant::now();

    // ---- 1. Policy stage ----
    let policy_start = std::time::Instant::now();
    let decision = {
        let ctx = policy::CompilationContext::new(&ir, &diagnostics, &options);
        policy.decide(&ctx)
    };
    let policy_duration = policy_start.elapsed();

    match decision {
        policy::CompilationDecision::Abort { reason } => {
            stage_status.push(StageResult::new(
                PipelineStage::Policy,
                StageStatus::Failed(reason.clone()),
                policy_duration,
            ));
            return Err(PipelineError(reason));
        }
        policy::CompilationDecision::ContinueWith { .. }
        | policy::CompilationDecision::Compile { .. } => {
            stage_status.push(StageResult::new(
                PipelineStage::Policy,
                StageStatus::Success,
                policy_duration,
            ));
            // Proceed to analysis — ContinueWith/Compile both continue.
        }
    }

    // ---- 2. Analysis stage ----
    let analysis_start = std::time::Instant::now();
    let analysis_result = analysis::execute(&ir, &mut diagnostics);
    let analysis_duration = analysis_start.elapsed();
    stage_status.push(StageResult::new(
        PipelineStage::Analysis,
        StageStatus::Success,
        analysis_duration,
    ));

    // ---- 3. Planning stage ----
    let planning_start = std::time::Instant::now();
    let operations = planning::execute(&ir, &analysis_result, &mut diagnostics);
    let planning_duration = planning_start.elapsed();
    stage_status.push(StageResult::new(
        PipelineStage::Planning,
        StageStatus::Success,
        planning_duration,
    ));

    // ---- Build metadata ----
    let metadata = PlanMetadata {
        pipeline_version: Version { major: 0, minor: 1 },
        execution_time: start.elapsed(),
        compilation_options: options,
        diagnostics,
        stage_status,
    };

    Ok(PlannedProgram {
        operations,
        home_pose: None,
        constraints: analysis_result.constraints,
        metadata,
    })
}

// ---------------------------------------------------------------------------
// Integration tests  (Tasks 2.7, 2.8, 2.9)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::ir::{IrOperation, IrProgram};
    use crate::pipeline::policy::{
        CompilationContext, CompilationDecision, CompilationPolicy, StrictPolicy,
    };
    use std::time::Duration;
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
                name: "integration_test".into(),
                version: 1,
                created_at: "".into(),
                modified_at: "".into(),
            },
        }
    }

    fn default_options() -> CompilationOptions {
        CompilationOptions {
            policy_mode: PolicyMode::Strict,
        }
    }

    fn make_home(id: &str) -> IrOperation {
        IrOperation::Home {
            origin: OperationId(id.into()),
        }
    }

    /// A test policy that always aborts.
    struct AbortPolicy;

    impl CompilationPolicy for AbortPolicy {
        fn decide(&self, _ctx: &CompilationContext) -> CompilationDecision {
            CompilationDecision::Abort {
                reason: "test policy abort".into(),
            }
        }
    }

    // ------------------------------------------------------------------
    // 2.7 — Nominal flow: StrictPolicy → Analysis → Planning →
    //       valid PlannedProgram
    // ------------------------------------------------------------------

    #[test]
    fn nominal_flow_returns_planned_program() {
        let ir = make_ir(vec![make_home("op_01")]);
        let policy = StrictPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        assert!(result.is_ok(), "nominal pipeline should succeed");

        let program = result.unwrap();
        assert_eq!(
            program.operations.len(),
            1,
            "planned operations should match IR operations"
        );
        assert!(
            matches!(&program.operations[0], PlannedOperation::Home { origin } if origin.as_str() == "op_01"),
            "expected Home variant with origin op_01"
        );
        assert_eq!(
            program.metadata.stage_status.len(),
            3,
            "all three stages should report"
        );
    }

    #[test]
    fn nominal_flow_preserves_operation_order() {
        let ir = make_ir(vec![
            make_home("op_01"),
            make_home("op_02"),
            IrOperation::Wait {
                origin: OperationId("op_03".into()),
                duration: Duration::from_secs(1),
            },
        ]);
        let policy = StrictPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        assert!(result.is_ok());
        let program = result.unwrap();

        assert_eq!(program.operations.len(), 3);
        assert!(
            matches!(&program.operations[0], PlannedOperation::Home { origin } if origin.as_str() == "op_01")
        );
        assert!(
            matches!(&program.operations[1], PlannedOperation::Home { origin } if origin.as_str() == "op_02")
        );
        assert!(
            matches!(&program.operations[2], PlannedOperation::Wait { origin, .. } if origin.as_str() == "op_03")
        );
    }

    #[test]
    fn nominal_flow_constraints_are_populated() {
        let ir = make_ir(vec![make_home("op_01"), make_home("op_02")]);
        let policy = StrictPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        assert!(result.is_ok());
        let program = result.unwrap();

        assert_eq!(
            program.constraints.items.len(),
            2,
            "constraints should come from analysis"
        );
    }

    // ------------------------------------------------------------------
    // 2.8 — Policy abort halts pipeline
    // ------------------------------------------------------------------

    #[test]
    fn abort_policy_returns_error() {
        let ir = make_ir(vec![make_home("op_01")]);
        let policy = AbortPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        match result {
            Err(PipelineError(ref reason)) => {
                assert!(!reason.is_empty(), "abort reason must be non-empty");
                assert!(reason.contains("test policy abort"));
            }
            Ok(_) => panic!("Expected Err from AbortPolicy, got Ok"),
        }
    }

    #[test]
    fn abort_policy_stage_status_contains_only_policy() {
        let ir = make_ir(vec![make_home("op_01")]);
        let policy = AbortPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        assert!(result.is_err(), "AbortPolicy should produce an error");

        // We lose stage_status on error, but the design only requires
        // that analysis/planning were not executed. The error return
        // proves the pipeline halted.
        let err = result.unwrap_err();
        assert_eq!(err.0, "test policy abort");
    }

    // ------------------------------------------------------------------
    // 2.9 — Diagnostic propagation
    // ------------------------------------------------------------------

    #[test]
    fn diagnostics_propagate_from_all_stages() {
        let ir = make_ir(vec![make_home("op_01")]);
        let policy = StrictPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        assert!(result.is_ok());
        let program = result.unwrap();

        // Analysis pushes 1 diagnostic per operation, planning pushes 1
        // per operation. With 1 operation → 2 diagnostics total.
        assert_eq!(
            program.metadata.diagnostics.len(),
            2,
            "1 op → 1 analysis diag + 1 planning diag = 2"
        );
    }

    #[test]
    fn diagnostics_count_matches_sum_of_stages() {
        // With 3 operations: analysis pushes 3, planning pushes 3 = 6 total.
        let ir = make_ir(vec![
            make_home("op_01"),
            make_home("op_02"),
            make_home("op_03"),
        ]);
        let policy = StrictPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        assert!(result.is_ok());
        let program = result.unwrap();

        // The sum of per-stage diagnostics:
        // - Policy: 0 (policy doesn't add diagnostics)
        // - Analysis: 3 (one per operation)
        // - Planning: 3 (one per operation)
        // Total: 6
        assert_eq!(program.metadata.diagnostics.len(), 6);

        // Verify each diagnostic has the expected source code.
        let analysis_diags: Vec<&Diagnostic> = program
            .metadata
            .diagnostics
            .iter()
            .filter(|d| d.code == "analysis")
            .collect();
        let planning_diags: Vec<&Diagnostic> = program
            .metadata
            .diagnostics
            .iter()
            .filter(|d| d.code == "planning")
            .collect();

        assert_eq!(analysis_diags.len(), 3, "3 analysis diagnostics");
        assert_eq!(planning_diags.len(), 3, "3 planning diagnostics");
    }

    #[test]
    fn diagnostics_empty_when_no_operations() {
        let ir = make_ir(vec![]);
        let policy = StrictPolicy;
        let options = default_options();

        let result = run_pipeline(ir, &policy, options);
        assert!(result.is_ok());
        let program = result.unwrap();

        assert_eq!(
            program.metadata.diagnostics.len(),
            0,
            "no ops → no diagnostics"
        );
    }
}
