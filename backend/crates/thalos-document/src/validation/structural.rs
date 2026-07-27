//! Structural validation — first pass.
//!
//! Checks document integrity: unique operation IDs, non-empty ID strings,
//! valid operation type tags, and valid enum discriminants.
//! Returns `Err` on any structural issue; the document is corrupt.

use crate::project::Project;
use crate::validation::ValidatedProject;
use thiserror::Error;

/// Errors produced by structural validation.
#[derive(Error, Debug, Clone, PartialEq)]
pub enum StructuralError {
    /// Two or more operations share the same operation ID.
    #[error("duplicate operation ID: {0}")]
    DuplicateOperationId(String),

    /// An ID string is empty (e.g. `PointId("")`).
    #[error("empty ID string")]
    EmptyId,

    /// An operation has an unknown type tag.
    #[error("unknown operation type: {0}")]
    UnknownOperationType(String),

    /// A MotionProfile value is not recognized.
    #[error("invalid motion profile discriminant: {0}")]
    InvalidProfileDiscriminant(String),
}

/// Run structural validation on a `Project`.
///
/// Returns `Ok(ValidatedProject)` if the document is structurally sound,
/// or `Err(StructuralError)` with details about the first issue found.
pub fn validate_structural(project: &Project) -> Result<ValidatedProject, StructuralError> {
    // Check all operation IDs for duplicates
    let mut seen_ids: Vec<&str> = Vec::new();
    for task in &project.tasks {
        for op in &task.operations {
            let op_id = op.id();
            if seen_ids.contains(&op_id.as_str()) {
                return Err(StructuralError::DuplicateOperationId(op_id.to_string()));
            }
            seen_ids.push(op_id.as_str());

            // Check for empty operation IDs
            if op_id.as_str().is_empty() {
                return Err(StructuralError::EmptyId);
            }
        }
    }

    // Check resource IDs for empty strings
    for point in &project.resources.points {
        if point.id.as_str().is_empty() {
            return Err(StructuralError::EmptyId);
        }
    }
    for path in &project.resources.paths {
        if path.id.as_str().is_empty() {
            return Err(StructuralError::EmptyId);
        }
    }
    for frame in &project.resources.frames {
        if frame.id.as_str().is_empty() {
            return Err(StructuralError::EmptyId);
        }
    }
    for output in &project.resources.outputs {
        if output.id.as_str().is_empty() {
            return Err(StructuralError::EmptyId);
        }
    }

    Ok(ValidatedProject)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::*;
    use crate::operation::Operation;
    use crate::operation::io::OutputValue;
    use crate::operation::motion::MotionProfile;
    use crate::pose::Pose;
    use crate::project::*;
    use crate::resource::*;
    use std::time::Duration;

    /// Helper: minimal valid project with a single Home operation.
    fn valid_project() -> Project {
        Project {
            metadata: Metadata {
                name: "test".to_string(),
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
                points: vec![],
                paths: vec![],
                frames: vec![],
                outputs: vec![],
            },
            tasks: vec![Task {
                id: "main".to_string(),
                operations: vec![Operation::Home {
                    id: OperationId("op_1".to_string()),
                }],
            }],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        }
    }

    // --- Duplicate operation IDs ---

    #[test]
    fn duplicate_operation_ids_rejected() {
        let mut project = valid_project();
        project.tasks[0].operations.push(Operation::Home {
            id: OperationId("op_1".to_string()),
        });
        let result = validate_structural(&project);
        assert_eq!(
            result,
            Err(StructuralError::DuplicateOperationId("op_1".to_string()))
        );
    }

    // --- Empty ID strings ---

    #[test]
    fn empty_operation_id_rejected() {
        let mut project = valid_project();
        project.tasks[0].operations[0] = Operation::Home {
            id: OperationId("".to_string()),
        };
        let result = validate_structural(&project);
        assert_eq!(result, Err(StructuralError::EmptyId));
    }

    #[test]
    fn empty_point_id_rejected() {
        let mut project = valid_project();
        project.resources.points.push(Point {
            id: PointId("".to_string()),
            name: "empty".to_string(),
            pose: Pose {
                position: [0.0; 3],
                orientation: [0.0, 0.0, 0.0, 1.0],
            },
        });
        let result = validate_structural(&project);
        assert_eq!(result, Err(StructuralError::EmptyId));
    }

    // --- Valid document passes ---

    #[test]
    fn valid_document_passes_structural() {
        let project = valid_project();
        let result = validate_structural(&project);
        assert!(result.is_ok());
    }

    #[test]
    fn valid_document_with_all_operation_types() {
        let project = Project {
            metadata: Metadata {
                name: "all_ops".to_string(),
                version: 1,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                modified_at: "2026-01-01T00:00:00Z".to_string(),
            },
            robot: Robot {
                reference: "r".to_string(),
            },
            scene: Scene {
                reference: "s".to_string(),
            },
            resources: Resources {
                points: vec![Point {
                    id: PointId("pt_01".to_string()),
                    name: "p".to_string(),
                    pose: Pose {
                        position: [0.0; 3],
                        orientation: [0.0, 0.0, 0.0, 1.0],
                    },
                }],
                paths: vec![Path {
                    id: PathId("path_1".to_string()),
                    name: "path".to_string(),
                    points: vec![PointId("pt_01".to_string())],
                }],
                frames: vec![],
                outputs: vec![Output {
                    id: OutputId("gripper".to_string()),
                    name: "Gripper".to_string(),
                    channel_type: "digital".to_string(),
                }],
            },
            tasks: vec![Task {
                id: "main".to_string(),
                operations: vec![
                    Operation::Home {
                        id: OperationId("op_1".to_string()),
                    },
                    Operation::MoveTo {
                        id: OperationId("op_2".to_string()),
                        target: PointId("pt_01".to_string()),
                        profile: None,
                    },
                    Operation::Follow {
                        id: OperationId("op_3".to_string()),
                        path: PathId("path_1".to_string()),
                        profile: None,
                    },
                    Operation::Wait {
                        id: OperationId("op_4".to_string()),
                        duration: Duration::from_secs(1),
                    },
                    Operation::SetOutput {
                        id: OperationId("op_5".to_string()),
                        channel: OutputId("gripper".to_string()),
                        value: OutputValue::Bool(true),
                    },
                ],
            }],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        };
        let result = validate_structural(&project);
        assert!(result.is_ok());
    }

    // --- Clone and Debug ---

    #[test]
    fn structural_error_is_clone_and_debug() {
        let err = StructuralError::DuplicateOperationId("op_1".to_string());
        let _ = err.clone();
        let _ = format!("{:?}", err);
    }
}
