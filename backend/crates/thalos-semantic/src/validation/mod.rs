use serde::{Deserialize, Serialize};
use thalos_core::ids::OperationId;

use crate::knowledge::KnowledgeProvider;
use crate::program::SemanticProgram;

mod level1;
mod level2;

/// Severity level for a validation diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Severity {
    Error,
    Warning,
}

/// A single validation finding — either an error or warning with trace origin.
///
/// Errors prevent lowering; warnings do not. Every diagnostic carries the
/// `OperationId` of the operation that caused it for traceability.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub origin: OperationId,
}

impl Diagnostic {
    /// Construct a new error diagnostic.
    pub fn error(message: impl Into<String>, origin: OperationId) -> Self {
        Self {
            severity: Severity::Error,
            message: message.into(),
            origin,
        }
    }

    /// Construct a new warning diagnostic.
    pub fn warning(message: impl Into<String>, origin: OperationId) -> Self {
        Self {
            severity: Severity::Warning,
            message: message.into(),
            origin,
        }
    }
}

/// The result of validating a `SemanticProgram`.
///
/// Errors prevent lowering; warnings do not. Diagnostics preserve the origin
/// trace ID of the operation that caused them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ValidationResult {
    pub errors: Vec<Diagnostic>,
    pub warnings: Vec<Diagnostic>,
}

impl ValidationResult {
    /// Returns `true` if there are any error-level diagnostics.
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }
}

/// Run Level 1 validation (sequence rules, no provider needed).
///
/// Checks structural correctness: Place-without-Pick violations, Home
/// parameter constraints, and other rules that do not require resource
/// resolution.
pub fn validate(program: &SemanticProgram) -> ValidationResult {
    level1::validate_level1(program)
}

/// Run both Level 1 and Level 2 validation.
///
/// Level 2 requires a `KnowledgeProvider` to resolve resource references and
/// is skipped if Level 1 produces errors.
pub fn validate_with_provider(
    program: &SemanticProgram,
    provider: &dyn KnowledgeProvider,
) -> ValidationResult {
    let mut result = validate(program);
    if result.has_errors() {
        // Level 1 already has errors — skip Level 2 validation
        return result;
    }
    let l2 = level2::validate_level2(program, provider);
    result.errors.extend(l2.errors);
    result.warnings.extend(l2.warnings);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use crate::operation::*;
    use crate::resource::*;

    // ── Helper builders ──────────────────────────────────────────────────

    fn make_pick(origin: &str, object: &str, tool: Option<&str>) -> SemanticOperation {
        SemanticOperation::Pick(PickOp {
            origin: OperationId(origin.to_string()),
            object: ObjectId(object.to_string()),
            tool: tool.map(|t| ToolId(t.to_string())),
        })
    }

    fn make_place(origin: &str, object: &str, destination: &str) -> SemanticOperation {
        SemanticOperation::Place(PlaceOp {
            origin: OperationId(origin.to_string()),
            object: ObjectId(object.to_string()),
            destination: LocationId(destination.to_string()),
            tool: None,
        })
    }

    fn make_wait(origin: &str, duration: Duration) -> SemanticOperation {
        SemanticOperation::Wait(WaitOp {
            origin: OperationId(origin.to_string()),
            duration,
        })
    }

    fn make_home(origin: &str) -> SemanticOperation {
        SemanticOperation::Home(HomeOp {
            origin: OperationId(origin.to_string()),
        })
    }

    fn make_move_to(origin: &str, destination: &str) -> SemanticOperation {
        SemanticOperation::MoveTo(MoveToOp {
            origin: OperationId(origin.to_string()),
            destination: LocationId(destination.to_string()),
            tool: None,
        })
    }

    macro_rules! assert_error_count {
        ($result:expr, $count:expr) => {
            assert_eq!(
                $result.errors.len(),
                $count,
                "Expected {} errors, got {}: {:?}",
                $count,
                $result.errors.len(),
                $result.errors
            );
        };
    }

    // ── Place without Pick ────────────────────────────────────────────────

    #[test]
    fn place_without_any_pick_errors() {
        let program = SemanticProgram::new(vec![make_place("place-1", "bolt-1", "tray-1")]);
        let result = validate(&program);
        assert_error_count!(result, 1);
        assert_eq!(result.errors[0].origin, OperationId("place-1".to_string()));
        assert!(
            result.errors[0].message.contains("bolt-1"),
            "Error message should reference the object name: {}",
            result.errors[0].message
        );
    }

    #[test]
    fn place_after_pick_of_different_object_errors() {
        let program = SemanticProgram::new(vec![
            make_pick("pick-1", "bolt-1", None),
            make_place("place-2", "bolt-2", "tray-1"),
        ]);
        let result = validate(&program);
        assert_error_count!(result, 1);
        assert_eq!(result.errors[0].origin, OperationId("place-2".to_string()));
    }

    #[test]
    fn pick_then_place_of_same_object_valid() {
        let program = SemanticProgram::new(vec![
            make_pick("pick-1", "bolt-1", None),
            make_place("place-2", "bolt-1", "tray-1"),
        ]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    #[test]
    fn pick_then_place_after_other_ops_valid() {
        // Pick and Place don't need to be adjacent — other ops can be between
        let program = SemanticProgram::new(vec![
            make_pick("pick-1", "bolt-1", None),
            make_move_to("move-2", "table"),
            make_wait("wait-3", Duration::from_secs(1)),
            make_place("place-4", "bolt-1", "tray-1"),
        ]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    // ── Wait duration ─────────────────────────────────────────────────────

    #[test]
    fn wait_zero_duration_valid() {
        let program =
            SemanticProgram::new(vec![make_wait("wait-1", Duration::ZERO)]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    #[test]
    fn wait_positive_duration_valid() {
        let program =
            SemanticProgram::new(vec![make_wait("wait-2", Duration::from_secs(5))]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    // ── Home parameterless ────────────────────────────────────────────────

    #[test]
    fn home_alone_no_errors() {
        let program = SemanticProgram::new(vec![make_home("home-1")]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    // ── Valid sequences ───────────────────────────────────────────────────

    #[test]
    fn pick_alone_valid() {
        let program = SemanticProgram::new(vec![make_pick("pick-1", "bolt-1", None)]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    #[test]
    fn home_alone_valid() {
        let program = SemanticProgram::new(vec![make_home("home-1")]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    #[test]
    fn empty_program_valid() {
        let program = SemanticProgram::new(vec![]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    #[test]
    fn valid_full_sequence_no_errors() {
        let program = SemanticProgram::new(vec![
            make_pick("op-1", "bolt-1", None),
            make_place("op-2", "bolt-1", "tray-1"),
            make_move_to("op-3", "shelf-a"),
            make_wait("op-4", Duration::from_secs(2)),
            make_home("op-5"),
        ]);
        let result = validate(&program);
        assert_error_count!(result, 0);
    }

    // ── Multiple errors ───────────────────────────────────────────────────

    #[test]
    fn multiple_place_without_pick_all_flagged() {
        let program = SemanticProgram::new(vec![
            make_place("p1", "bolt-1", "tray-1"),
            make_place("p2", "nut-2", "tray-2"),
        ]);
        let result = validate(&program);
        assert_error_count!(result, 2);
    }

    // ── Validation is read-only ───────────────────────────────────────────

    #[test]
    fn validation_is_read_only() {
        let ops = vec![
            make_pick("op-1", "bolt-1", None),
            make_place("op-2", "bolt-1", "tray-1"),
            make_home("op-3"),
        ];
        let program = SemanticProgram::new(ops);
        let len_before = program.operations.len();
        let _result = validate(&program);
        assert_eq!(
            program.operations.len(),
            len_before,
            "Validation must not mutate the program"
        );
    }

    // ── Warning diagnostics ───────────────────────────────────────────────

    #[test]
    fn warning_construction() {
        let d = Diagnostic::warning("test warning", OperationId("w-1".to_string()));
        assert_eq!(d.severity, Severity::Warning);
        assert_eq!(d.message, "test warning");
        assert_eq!(d.origin, OperationId("w-1".to_string()));
    }

    #[test]
    fn error_construction() {
        let d = Diagnostic::error("test error", OperationId("e-1".to_string()));
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(d.message, "test error");
        assert_eq!(d.origin, OperationId("e-1".to_string()));
    }

    // ── ValidationResult helpers ──────────────────────────────────────────

    #[test]
    fn validation_result_has_errors_positive() {
        let result = ValidationResult {
            errors: vec![Diagnostic::error("err", OperationId("1".to_string()))],
            warnings: vec![],
        };
        assert!(result.has_errors());
    }

    #[test]
    fn validation_result_has_errors_negative() {
        let result = ValidationResult::default();
        assert!(!result.has_errors());
    }
}
