//! Semantic validation — second pass.
//!
//! Runs only after structural validation passes. Checks logical correctness:
//! all ID references resolve, paths are non-empty, and profile names are
//! within the known vocabulary. Returns a `Vec<Diagnostic>` — the document is
//! structurally valid but may contain issues.

use std::collections::HashSet;

use crate::diagnostic::Diagnostic;
use crate::operation::Operation;
use crate::operation::motion::MotionProfile;
use crate::project::Project;

/// Known motion profile vocabulary for semantic profile-name checks.
const KNOWN_PROFILES: &[&str] = &["slow", "fast", "standard"];

/// Run semantic validation on a structurally valid `Project`.
///
/// Returns a (possibly empty) vector of diagnostics. An empty vector
/// means the document is fully valid.
pub fn validate_semantic(project: &Project) -> Vec<Diagnostic> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    // Build lookup sets for existing resource IDs.
    let point_ids: HashSet<&str> = project
        .resources
        .points
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    let path_ids: HashSet<&str> = project
        .resources
        .paths
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    let output_ids: HashSet<&str> = project
        .resources
        .outputs
        .iter()
        .map(|o| o.id.as_str())
        .collect();

    // Check empty paths.
    for path in &project.resources.paths {
        if path.points.is_empty() {
            diagnostics.push(
                Diagnostic::warning(
                    "empty-path",
                    format!("Path '{}' has no point references", path.id),
                    path.id.to_string(),
                )
                .with_help("Add at least one PointId to the path's points list"),
            );
        }
    }

    // Check each operation's references and profile.
    for task in &project.tasks {
        for op in &task.operations {
            match op {
                Operation::MoveTo {
                    id,
                    target,
                    profile,
                } => {
                    if !point_ids.contains(target.as_str()) {
                        diagnostics.push(unresolved(id.as_str(), "Point", target.as_str()));
                    }
                    check_profile(profile, id.as_str(), &mut diagnostics);
                }
                Operation::Follow { id, path, profile } => {
                    if !path_ids.contains(path.as_str()) {
                        diagnostics.push(unresolved(id.as_str(), "Path", path.as_str()));
                    }
                    check_profile(profile, id.as_str(), &mut diagnostics);
                }
                Operation::SetOutput { id, channel, .. } => {
                    if !output_ids.contains(channel.as_str()) {
                        diagnostics.push(unresolved(id.as_str(), "Output", channel.as_str()));
                    }
                }
                Operation::Home { .. } | Operation::Wait { .. } => {
                    // No ID references to validate.
                }
            }
        }
    }

    diagnostics
}

/// Build an "unresolved-resource" diagnostic.
fn unresolved(span: &str, kind: &str, id: &str) -> Diagnostic {
    Diagnostic::error(
        "unresolved-resource",
        format!("{kind} resource '{id}' does not exist"),
        span,
    )
    .with_help(format!(
        "Add a {kind} resource with id '{id}' or fix the reference"
    ))
}

/// Check whether a motion profile is recognized.
fn check_profile(profile: &Option<MotionProfile>, span: &str, diagnostics: &mut Vec<Diagnostic>) {
    if let Some(MotionProfile::Named(name)) = profile
        && !KNOWN_PROFILES.contains(&name.as_str())
    {
        diagnostics.push(
            Diagnostic::warning(
                "unknown-profile",
                format!("Motion profile '{name}' is not in the known vocabulary"),
                span,
            )
            .with_help(format!("Use one of: {}", KNOWN_PROFILES.join(", "))),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::Severity;
    use crate::id::*;
    use crate::operation::io::OutputValue;
    use crate::operation::motion::MotionProfile;
    use crate::pose::Pose;
    use crate::project::*;
    use crate::resource::*;

    fn project_with_resources() -> Project {
        Project {
            metadata: Metadata {
                name: "semantic".to_string(),
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
                points: vec![
                    Point {
                        id: PointId("pt_01".to_string()),
                        name: "start".to_string(),
                        pose: Pose {
                            position: [0.0; 3],
                            orientation: [0.0, 0.0, 0.0, 1.0],
                        },
                    },
                    Point {
                        id: PointId("pt_02".to_string()),
                        name: "end".to_string(),
                        pose: Pose {
                            position: [1.0, 0.0, 0.0],
                            orientation: [0.0, 0.0, 0.0, 1.0],
                        },
                    },
                ],
                paths: vec![Path {
                    id: PathId("path_1".to_string()),
                    name: "weld".to_string(),
                    points: vec![PointId("pt_01".to_string()), PointId("pt_02".to_string())],
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

    // --- Dangling ID reference ---

    #[test]
    fn dangling_point_id_produces_diagnostic() {
        let mut project = project_with_resources();
        project.tasks[0].operations[0] = Operation::MoveTo {
            id: OperationId("op_1".to_string()),
            target: PointId("pt_99".to_string()),
            profile: None,
        };
        let diags = validate_semantic(&project);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].code, "unresolved-resource");
        assert_eq!(diags[0].severity, Severity::Error);
        assert!(diags[0].message.contains("pt_99"));
    }

    #[test]
    fn dangling_path_id_produces_diagnostic() {
        let mut project = project_with_resources();
        project.tasks[0].operations[0] = Operation::Follow {
            id: OperationId("op_1".to_string()),
            path: PathId("path_99".to_string()),
            profile: None,
        };
        let diags = validate_semantic(&project);
        assert!(!diags.is_empty());
        assert!(diags.iter().any(|d| d.code == "unresolved-resource"));
    }

    #[test]
    fn dangling_output_id_produces_diagnostic() {
        let mut project = project_with_resources();
        project.tasks[0].operations[0] = Operation::SetOutput {
            id: OperationId("op_1".to_string()),
            channel: OutputId("nonexistent".to_string()),
            value: OutputValue::Bool(true),
        };
        let diags = validate_semantic(&project);
        assert!(!diags.is_empty());
        assert!(diags.iter().any(|d| d.code == "unresolved-resource"));
    }

    // --- Empty path ---

    #[test]
    fn empty_path_produces_diagnostic() {
        let mut project = project_with_resources();
        project.resources.paths.push(Path {
            id: PathId("empty_path".to_string()),
            name: "empty".to_string(),
            points: vec![],
        });
        let diags = validate_semantic(&project);
        assert!(diags.iter().any(|d| d.code == "empty-path"));
    }

    // --- Unknown profile name ---

    #[test]
    fn unknown_profile_name_produces_warning() {
        let mut project = project_with_resources();
        project.tasks[0].operations[0] = Operation::MoveTo {
            id: OperationId("op_1".to_string()),
            target: PointId("pt_01".to_string()),
            profile: Some(MotionProfile::Named("turbo".to_string())),
        };
        let diags = validate_semantic(&project);
        assert!(!diags.is_empty());
        let unknown = diags.iter().find(|d| d.code == "unknown-profile");
        assert!(unknown.is_some());
        assert_eq!(unknown.unwrap().severity, Severity::Warning);
    }

    // --- Valid references produce no diagnostics ---

    #[test]
    fn valid_references_produce_no_diagnostics() {
        let project = project_with_resources();
        let diags = validate_semantic(&project);
        assert!(diags.is_empty());
    }

    // --- Multiple diagnostics collected ---

    #[test]
    fn multiple_dangling_refs_collect_many_diagnostics() {
        let mut project = project_with_resources();
        project.tasks[0].operations = vec![
            Operation::MoveTo {
                id: OperationId("op_1".to_string()),
                target: PointId("pt_missing_1".to_string()),
                profile: None,
            },
            Operation::Follow {
                id: OperationId("op_2".to_string()),
                path: PathId("path_missing".to_string()),
                profile: None,
            },
            Operation::SetOutput {
                id: OperationId("op_3".to_string()),
                channel: OutputId("output_missing".to_string()),
                value: OutputValue::Bool(false),
            },
        ];
        project.resources.paths.push(Path {
            id: PathId("empty_path".to_string()),
            name: "empty".to_string(),
            points: vec![],
        });
        let diags = validate_semantic(&project);
        assert_eq!(diags.len(), 4);
    }
}
