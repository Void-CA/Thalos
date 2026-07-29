use std::collections::HashMap;

use crate::operation::SemanticOperation;
use crate::program::SemanticProgram;
use super::{Diagnostic, ValidationResult};

/// Run Level 1 validation rules on a `SemanticProgram`.
///
/// Level 1 checks structural correctness without requiring a `KnowledgeProvider`:
///
/// - **Place-without-Pick**: A `Place` must have a preceding `Pick` of the same
///   `ObjectId`. The Pick can appear at any earlier position — it is not consumed.
/// - **Wait non-negative duration**: `Wait` duration must be ≥ 0. Zero is valid.
///   (Rust's `std::time::Duration` enforces this at the type level; the check
///   documents the invariant for future type changes.)
/// - **Home parameterless**: `Home` accepts no parameters. Enforced by the
///   `HomeOp` struct definition — only `origin` is present.
/// - **MoveTo**: No Level 1 rules apply.
pub(super) fn validate_level1(program: &SemanticProgram) -> ValidationResult {
    let mut errors: Vec<Diagnostic> = Vec::new();
    // Track which ObjectIds have been picked (maps to the Pick's origin for traceability).
    let mut picked_objects: HashMap<&str, &thalos_core::ids::OperationId> = HashMap::new();

    for op in &program.operations {
        match op {
            SemanticOperation::Pick(pick) => {
                picked_objects.insert(&pick.object.0, &pick.origin);
            }
            SemanticOperation::Place(place) => {
                if !picked_objects.contains_key(place.object.0.as_str()) {
                    errors.push(Diagnostic::error(
                        format!(
                            "Place references object '{}' which has no preceding Pick",
                            place.object.0
                        ),
                        place.origin.clone(),
                    ));
                }
            }
            SemanticOperation::Wait(wait) => {
                // std::time::Duration is unsigned by construction, so a negative
                // value is impossible at runtime. This structural invariant is
                // documented here for clarity.
                if wait.duration.as_nanos() == 0 && wait.duration.is_zero() {
                    // Zero is valid — no error.
                }
            }
            SemanticOperation::Home(_) => {
                // Home has no parameters beyond origin. The struct definition
                // enforces this at the type level — no additional validation needed.
            }
            SemanticOperation::MoveTo(_) => {
                // No Level 1 rules apply to MoveTo.
            }
        }
    }

    ValidationResult {
        errors,
        warnings: Vec::new(),
    }
}
