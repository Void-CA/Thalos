//! Analysis stage — derives constraints from the post-policy IR program.
//!
//! This stage is purely descriptive: it answers what is known about the
//! problem without selecting strategies. Strategy selection belongs to
//! the planning stage.

use crate::ir::{IrOperation, IrProgram};
use thalos_document::diagnostic::Diagnostic;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Marker type for the analysis stage.
#[derive(Debug, Clone, PartialEq)]
pub struct AnalysisStage;

/// Result of the analysis stage.
///
/// Carries the derived `ConstraintSet`. Reachability, manipulability, and
/// collision fields will be added as `Option` fields in a future iteration.
/// Diagnostics are NOT stored here — they go to the pipeline collector.
#[derive(Debug, Clone, PartialEq)]
pub struct AnalysisResult {
    /// Constraints derived from all IR operations.
    pub constraints: ConstraintSet,
}

/// A set of constraints derived from IR operations.
///
/// Currently a simplified placeholder backed by `Vec<String>`. May be
/// replaced by or augmented with types from `thalos-planning`.
#[derive(Debug, Clone, PartialEq)]
pub struct ConstraintSet {
    /// Individual constraint entries.
    pub items: Vec<String>,
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/// Run the analysis stage — derive constraints from all IR operations.
///
/// This is a free function for convenience; `AnalysisStage::execute` is the
/// canonical entry point.
pub fn execute(ir: &IrProgram, diagnostics: &mut Vec<Diagnostic>) -> AnalysisResult {
    AnalysisStage::execute(ir, diagnostics)
}

impl AnalysisStage {
    /// Execute the analysis stage — derive constraints from IR operations.
    ///
    /// Currently extracts one constraint entry per operation using its
    /// `OperationId`. Produces one diagnostic per operation for traceability.
    /// Future iterations will compute reachability, manipulability, and
    /// collision constraints and may push additional diagnostics for edge
    /// cases (e.g. near-singularity configurations).
    pub fn execute(ir: &IrProgram, diagnostics: &mut Vec<Diagnostic>) -> AnalysisResult {
        for op in &ir.operations {
            diagnostics.push(Diagnostic::warning(
                "analysis",
                format!("analysed operation {}", op_constraint_label(op)),
                "pipeline",
            ));
        }

        let items: Vec<String> = ir.operations.iter().map(op_constraint_label).collect();
        AnalysisResult {
            constraints: ConstraintSet { items },
        }
    }
}

/// Produce a human-readable constraint label for an IR operation.
fn op_constraint_label(op: &IrOperation) -> String {
    let origin = match op {
        IrOperation::Home { origin }
        | IrOperation::MoveTo { origin, .. }
        | IrOperation::Follow { origin, .. }
        | IrOperation::Wait { origin, .. }
        | IrOperation::SetOutput { origin, .. } => origin.as_str(),
    };
    let kind = match op {
        IrOperation::Home { .. } => "home",
        IrOperation::MoveTo { .. } => "move_to",
        IrOperation::Follow { .. } => "follow",
        IrOperation::Wait { .. } => "wait",
        IrOperation::SetOutput { .. } => "set_output",
    };
    format!("{origin}:{kind}")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::IrProgram;
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
                name: "test".into(),
                version: 1,
                created_at: "".into(),
                modified_at: "".into(),
            },
        }
    }

    fn make_home(id: &str) -> IrOperation {
        IrOperation::Home {
            origin: OperationId(id.into()),
        }
    }

    // ------------------------------------------------------------------
    // 2.5 — Structural: ConstraintSet construction, field assertions
    // ------------------------------------------------------------------

    #[test]
    fn constraint_set_construction() {
        let cs = ConstraintSet {
            items: vec!["op_01:home".into()],
        };
        assert_eq!(cs.items.len(), 1);
        assert_eq!(cs.items[0], "op_01:home");
    }

    #[test]
    fn constraint_set_empty() {
        let cs = ConstraintSet { items: vec![] };
        assert!(cs.items.is_empty());
    }

    #[test]
    fn constraint_set_multiple_items() {
        let cs = ConstraintSet {
            items: vec!["a".into(), "b".into(), "c".into()],
        };
        assert_eq!(cs.items.len(), 3);
    }

    #[test]
    fn analysis_result_construction() {
        let cs = ConstraintSet {
            items: vec!["op_01:home".into()],
        };
        let result = AnalysisResult { constraints: cs };
        assert_eq!(result.constraints.items.len(), 1);
    }

    // ------------------------------------------------------------------
    // 2.5 — Behavioral: analysis produces constraints per operation
    // ------------------------------------------------------------------

    #[test]
    fn analysis_produces_one_constraint_per_operation() {
        let ir = make_ir(vec![
            make_home("op_01"),
            IrOperation::Wait {
                origin: OperationId("op_02".into()),
                duration: Duration::from_secs(1),
            },
        ]);
        let mut diags = vec![];
        let result = execute(&ir, &mut diags);
        assert_eq!(
            result.constraints.items.len(),
            2,
            "should produce one constraint per operation"
        );
    }

    #[test]
    fn analysis_constraint_labels_contain_origin_and_kind() {
        let ir = make_ir(vec![
            make_home("op_01"),
            IrOperation::Wait {
                origin: OperationId("op_02".into()),
                duration: Duration::from_secs(1),
            },
        ]);
        let mut diags = vec![];
        let result = execute(&ir, &mut diags);

        assert_eq!(result.constraints.items[0], "op_01:home");
        assert_eq!(result.constraints.items[1], "op_02:wait");
    }

    #[test]
    fn analysis_empty_ir_produces_empty_constraints() {
        let ir = make_ir(vec![]);
        let mut diags = vec![];
        let result = execute(&ir, &mut diags);
        assert!(
            result.constraints.items.is_empty(),
            "empty IR should produce no constraints"
        );
    }

    // ------------------------------------------------------------------
    // Clone + Debug hygiene (2.2 structural)
    // ------------------------------------------------------------------

    #[test]
    fn analysis_stage_clone_and_debug() {
        let ir = make_ir(vec![make_home("op_01")]);
        let mut diags = vec![];
        let result = execute(&ir, &mut diags);
        let _ = format!("{result:?}");
    }
}
