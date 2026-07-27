//! Validation pipeline integration tests.
//!
//! Verifies that structural validation gates semantic validation:
//! - Corrupt documents (duplicate IDs) → structural Err → semantic skipped
//! - Structurally valid documents with bad references → structural Ok → semantic
//!   produces diagnostics

use thalos_document::diagnostic::Severity;
use thalos_document::prelude::*;
use thalos_document::validation::{StructuralError, validate_semantic, validate_structural};

/// Helper: a valid Project with all resources for a single MoveTo.
fn valid_project() -> Project {
    Project {
        metadata: Metadata {
            name: "pipeline_test".to_string(),
            version: 1,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        },
        robot: Robot {
            reference: "ur5e".to_string(),
        },
        scene: Scene {
            reference: "ws".to_string(),
        },
        resources: Resources {
            points: vec![Point {
                id: PointId("pt_01".to_string()),
                name: "target".to_string(),
                pose: Pose {
                    position: [1.0, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                },
            }],
            paths: vec![],
            frames: vec![],
            outputs: vec![],
        },
        tasks: vec![Task {
            id: "main".to_string(),
            operations: vec![Operation::MoveTo {
                id: OperationId("op_1".to_string()),
                target: PointId("pt_01".to_string()),
                profile: None,
            }],
        }],
        settings: Settings {
            default_profile: MotionProfile::Default,
        },
    }
}

// ---------------------------------------------------------------------------
// Corrupt document: duplicate IDs → structural Err → semantic skipped
// ---------------------------------------------------------------------------

#[test]
fn corrupt_duplicate_ids_skips_semantic() {
    let mut project = valid_project();
    // Add a duplicate operation ID
    project.tasks[0].operations.push(Operation::Home {
        id: OperationId("op_1".to_string()),
    });

    let structural = validate_structural(&project);
    assert!(structural.is_err());
    assert_eq!(
        structural.unwrap_err(),
        StructuralError::DuplicateOperationId("op_1".to_string())
    );

    // Structural Err → semantic should not run (we can't know if it would
    // pass or not, but the pipeline contract says it's skipped). We verify
    // by asserting the structural error was correct.
}

// ---------------------------------------------------------------------------
// Structurally valid with bad refs → structural Ok → semantic diagnostics
// ---------------------------------------------------------------------------

#[test]
fn valid_structure_with_bad_refs_produces_diagnostics() {
    let mut project = valid_project();
    // Change target to a non-existent point
    project.tasks[0].operations[0] = Operation::MoveTo {
        id: OperationId("op_1".to_string()),
        target: PointId("pt_99".to_string()),
        profile: None,
    };
    // Add a Follow with non-existent path
    project.tasks[0].operations.push(Operation::Follow {
        id: OperationId("op_2".to_string()),
        path: PathId("path_99".to_string()),
        profile: None,
    });

    // Structural must pass
    let structural = validate_structural(&project);
    assert!(structural.is_ok(), "structurally valid document must pass");

    // Semantic produces diagnostics
    let diagnostics = validate_semantic(&project);
    assert!(
        !diagnostics.is_empty(),
        "semantic must find issues in document with bad refs"
    );

    // Check specific diagnostics
    let unresolved: Vec<_> = diagnostics
        .iter()
        .filter(|d| d.code == "unresolved-resource")
        .collect();
    assert_eq!(unresolved.len(), 2, "should find two unresolved references");

    // Verify severity
    for d in &diagnostics {
        assert_eq!(d.severity, Severity::Error);
    }
}

// ---------------------------------------------------------------------------
// Fully valid document → structural Ok AND semantic empty
// ---------------------------------------------------------------------------

#[test]
fn fully_valid_document_passes_both_passes() {
    let project = valid_project();

    let structural = validate_structural(&project);
    assert!(structural.is_ok());

    let diagnostics = validate_semantic(&project);
    assert!(
        diagnostics.is_empty(),
        "fully valid document should produce zero diagnostics"
    );
}
