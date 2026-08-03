//! Semantic validation — second pass.
//!
//! Runs only after structural validation passes. Checks logical correctness:
//! all ID references resolve, paths are non-empty, and profile names are
//! within the known vocabulary. Returns a `Vec<Observation>` from the unified
//! analysis model — the document is structurally valid but may contain issues.
//!
//! # Observation schema (spec I1/I2/I3, user contract C3)
//!
//! Document validation speaks the SAME language as semantic-program validation:
//! canonical `Observation`s, anchored to the `TaskDocument` artifact (I3).
//! `Project` carries no stable id today, so the anchor uses the stable
//! placeholder [`DOCUMENT_ARTIFACT_ID`]; supplying the real `TaskDocumentId`
//! is a follow-up when document identity lands on the model.
//!
//! | Legacy code | kind | severity | location | attributes |
//! |---|---|---|---|---|
//! | `unresolved-resource` (Point/Path/Output) | `UnresolvableReference` | Error | `Operation(op_id)` | `resource_type`, `resource_id` |
//! | `unknown-profile` | `UnresolvableReference` | Warning | `Operation(op_id)` | `profile` |
//! | `empty-path` | `EmptyPath` | Warning | `Operation(path_id)` | `path_id` |
//!
//! `message`/`help` are dropped — presentation is the renderer's
//! responsibility (I1). `resource_type`/`resource_id`/`profile`/`path_id`
//! are typed domain data (D5).

use std::collections::{BTreeMap, HashSet};

use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::analysis::location::Location;
use thalos_core::analysis::observation::{
    ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
};
use thalos_core::ids::{OperationId, TaskDocumentId};

use crate::operation::Operation;
use crate::operation::motion::MotionProfile;
use crate::project::Project;

/// Known motion profile vocabulary for semantic profile-name checks.
const KNOWN_PROFILES: &[&str] = &["slow", "fast", "standard"];

/// Stable artifact anchor for document validation observations (spec I3).
const DOCUMENT_ARTIFACT_ID: &str = "task-document";

/// Anchor every validation observation to the document under validation (I3).
fn document_artifact() -> ArtifactRef {
    ArtifactRef::TaskDocument(TaskDocumentId(DOCUMENT_ARTIFACT_ID.to_string()))
}

/// Build a canonical validation observation (the aggregator reassigns ids).
fn observation(
    kind: ObservationKind,
    severity: Severity,
    location: Location,
    attributes: BTreeMap<String, AttributeValue>,
) -> Observation {
    Observation {
        id: ObservationId(0),
        kind,
        severity,
        artifact: document_artifact(),
        location,
        attributes,
        causes: Vec::new(),
        related: Vec::new(),
    }
}

/// Run semantic validation on a structurally valid `Project`.
///
/// Returns a (possibly empty) vector of observations. An empty vector
/// means the document is fully valid.
pub fn validate_semantic(project: &Project) -> Vec<Observation> {
    let mut observations: Vec<Observation> = Vec::new();

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
            let mut attributes = BTreeMap::new();
            attributes.insert(
                "path_id".to_string(),
                AttributeValue::Text(path.id.to_string()),
            );
            observations.push(observation(
                ObservationKind::EmptyPath,
                Severity::Warning,
                // The old span was the path id; Location::Operation is the
                // generic id-carrying location anchor, so the id is also
                // machine-addressable from the location.
                Location::Operation(OperationId(path.id.to_string())),
                attributes,
            ));
        }
    }

    // Check each operation's references and profile.
    for task in &project.tasks {
        let operations = match &task.kind {
            crate::project::TaskKind::Geometric { operations } => operations,
            crate::project::TaskKind::Semantic { .. } => continue,
        };
        for op in operations {
            match op {
                Operation::MoveTo {
                    id,
                    target,
                    profile,
                } => {
                    if !point_ids.contains(target.as_str()) {
                        observations.push(unresolved(id, "Point", target.as_str()));
                    }
                    check_profile(profile, id, &mut observations);
                }
                Operation::Follow { id, path, profile } => {
                    if !path_ids.contains(path.as_str()) {
                        observations.push(unresolved(id, "Path", path.as_str()));
                    }
                    check_profile(profile, id, &mut observations);
                }
                Operation::SetOutput { id, channel, .. } => {
                    if !output_ids.contains(channel.as_str()) {
                        observations.push(unresolved(id, "Output", channel.as_str()));
                    }
                }
                Operation::Home { .. } | Operation::Wait { .. } => {
                    // No ID references to validate.
                }
            }
        }
    }

    observations
}

/// Build an "unresolved-resource" observation.
fn unresolved(span: &OperationId, kind: &str, id: &str) -> Observation {
    let mut attributes = BTreeMap::new();
    attributes.insert(
        "resource_type".to_string(),
        AttributeValue::Text(kind.to_string()),
    );
    attributes.insert(
        "resource_id".to_string(),
        AttributeValue::Text(id.to_string()),
    );
    observation(
        ObservationKind::UnresolvableReference,
        Severity::Error,
        Location::Operation(span.clone()),
        attributes,
    )
}

/// Check whether a motion profile is recognized.
fn check_profile(
    profile: &Option<MotionProfile>,
    span: &OperationId,
    observations: &mut Vec<Observation>,
) {
    if let Some(MotionProfile::Named(name)) = profile
        && !KNOWN_PROFILES.contains(&name.as_str())
    {
        let mut attributes = BTreeMap::new();
        attributes.insert(
            "profile".to_string(),
            AttributeValue::Text(name.to_string()),
        );
        observations.push(observation(
            ObservationKind::UnresolvableReference,
            Severity::Warning,
            Location::Operation(span.clone()),
            attributes,
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::*;
    use crate::operation::io::OutputValue;
    use crate::operation::motion::MotionProfile;
    use crate::pose::Pose;
    use crate::project::*;
    use crate::resource::*;
    use thalos_core::analysis::attribute_value::AttributeValue;
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{ObservationKind, Severity};

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
                objects: vec![],
                locations: vec![],
                tools: vec![],
            },
            tasks: vec![Task::geometric(
                "main",
                vec![Operation::MoveTo {
                    id: OperationId("op_1".to_string()),
                    target: PointId("pt_01".to_string()),
                    profile: None,
                }],
            )],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        }
    }

    // --- Dangling ID reference ---

    #[test]
    fn dangling_point_id_produces_unresolvable_reference() {
        let mut project = project_with_resources();
        project.tasks[0].kind.geometric_operations_mut().unwrap()[0] = Operation::MoveTo {
            id: OperationId("op_1".to_string()),
            target: PointId("pt_99".to_string()),
            profile: None,
        };
        let observations = validate_semantic(&project);
        assert_eq!(observations.len(), 1);
        assert_eq!(observations[0].kind, ObservationKind::UnresolvableReference);
        assert_eq!(observations[0].severity, Severity::Error);
        assert_eq!(
            observations[0].location,
            Location::Operation(OperationId("op_1".to_string()))
        );
        assert_eq!(
            observations[0].attributes["resource_type"],
            AttributeValue::Text("Point".to_string())
        );
        assert_eq!(
            observations[0].attributes["resource_id"],
            AttributeValue::Text("pt_99".to_string())
        );
    }

    #[test]
    fn dangling_path_id_produces_unresolvable_reference() {
        let mut project = project_with_resources();
        project.tasks[0].kind.geometric_operations_mut().unwrap()[0] = Operation::Follow {
            id: OperationId("op_1".to_string()),
            path: PathId("path_99".to_string()),
            profile: None,
        };
        let observations = validate_semantic(&project);
        assert!(!observations.is_empty());
        assert!(
            observations
                .iter()
                .all(|o| o.kind == ObservationKind::UnresolvableReference)
        );
    }

    #[test]
    fn dangling_output_id_produces_unresolvable_reference() {
        let mut project = project_with_resources();
        project.tasks[0].kind.geometric_operations_mut().unwrap()[0] = Operation::SetOutput {
            id: OperationId("op_1".to_string()),
            channel: OutputId("nonexistent".to_string()),
            value: OutputValue::Bool(true),
        };
        let observations = validate_semantic(&project);
        assert!(!observations.is_empty());
        assert!(
            observations
                .iter()
                .all(|o| o.kind == ObservationKind::UnresolvableReference)
        );
    }

    // --- Empty path ---

    #[test]
    fn empty_path_produces_empty_path_observation() {
        let mut project = project_with_resources();
        project.resources.paths.push(Path {
            id: PathId("empty_path".to_string()),
            name: "empty".to_string(),
            points: vec![],
        });
        let observations = validate_semantic(&project);
        let empty = observations
            .iter()
            .find(|o| o.kind == ObservationKind::EmptyPath);
        assert!(empty.is_some(), "empty path must surface as EmptyPath");
        assert_eq!(empty.unwrap().severity, Severity::Warning);
        assert_eq!(
            empty.unwrap().attributes["path_id"],
            AttributeValue::Text("empty_path".to_string())
        );
    }

    // --- Unknown profile name ---

    #[test]
    fn unknown_profile_name_produces_warning_unresolvable_reference() {
        // A motion-profile reference outside the known vocabulary is an
        // UnresolvableReference (the phenomenon: a reference that cannot be
        // resolved), kept at Warning severity.
        let mut project = project_with_resources();
        project.tasks[0].kind.geometric_operations_mut().unwrap()[0] = Operation::MoveTo {
            id: OperationId("op_1".to_string()),
            target: PointId("pt_01".to_string()),
            profile: Some(MotionProfile::Named("turbo".to_string())),
        };
        let observations = validate_semantic(&project);
        assert!(!observations.is_empty());
        let unknown = observations
            .iter()
            .find(|o| o.kind == ObservationKind::UnresolvableReference);
        assert!(unknown.is_some());
        assert_eq!(unknown.unwrap().severity, Severity::Warning);
        assert_eq!(
            unknown.unwrap().attributes["profile"],
            AttributeValue::Text("turbo".to_string())
        );
    }

    // --- Valid references produce no observations ---

    #[test]
    fn valid_references_produce_no_observations() {
        let project = project_with_resources();
        let observations = validate_semantic(&project);
        assert!(observations.is_empty());
    }

    // --- Multiple diagnostics collected ---

    #[test]
    fn multiple_dangling_refs_collect_many_observations() {
        let mut project = project_with_resources();
        *project.tasks[0].kind.geometric_operations_mut().unwrap() = vec![
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
        let observations = validate_semantic(&project);
        assert_eq!(observations.len(), 4);
    }
}
