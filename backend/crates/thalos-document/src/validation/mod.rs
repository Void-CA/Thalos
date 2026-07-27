//! Two-pass validation pipeline for task documents.
//!
//! Structural validation (first pass) checks document integrity: unique IDs,
//! non-empty ID strings, and valid enum discriminants.
//!
//! Semantic validation (second pass) checks logical correctness: all ID
//! references resolve, paths are non-empty, and profile names are known.

pub mod semantic;
pub mod structural;

pub use semantic::validate_semantic;
pub use structural::StructuralError;
pub use structural::validate_structural;

/// Marker type returned by `validate_structural` on success.
///
/// The presence of this value proves that structural checks passed.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedProject;
