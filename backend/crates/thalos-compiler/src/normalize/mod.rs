use crate::diagnostics::NormalizationError;
use crate::ir::*;
use thalos_document::id::*;
use thalos_document::operation::Operation;
use thalos_document::operation::motion::MotionProfile;
use thalos_document::project::Project;
use thalos_document::resource::Resources;
use thalos_document::validation::ValidatedProject;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDENTITY_4X4: [f64; 16] = [
    1.0, 0.0, 0.0, 0.0, //
    0.0, 1.0, 0.0, 0.0, //
    0.0, 0.0, 1.0, 0.0, //
    0.0, 0.0, 0.0, 1.0, //
];

const DEFAULT_VELOCITY: f64 = 0.5;
const DEFAULT_ACCELERATION: f64 = 1.0;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Normalize a structurally validated Project into a fully resolved IrProgram.
///
/// The `_proof` gate ensures only structurally valid documents enter
/// compilation — this is enforced by `validate_structural` in thalos-document.
pub fn normalize(
    project: &Project,
    _proof: &ValidatedProject,
) -> Result<IrProgram, NormalizationError> {
    let mut operations = Vec::new();

    for task in &project.tasks {
        for op in &task.operations {
            let ir_op = normalize_operation(op, &project.resources)?;
            operations.push(ir_op);
        }
    }

    Ok(IrProgram {
        version: 1,
        operations,
        source_metadata: project.metadata.clone(),
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn normalize_operation(
    op: &Operation,
    resources: &Resources,
) -> Result<IrOperation, NormalizationError> {
    match op {
        Operation::Home { id } => Ok(IrOperation::Home { origin: id.clone() }),
        Operation::MoveTo {
            id,
            target,
            profile,
        } => {
            let point = resolve_point(target, resources)?;
            let resolved_profile = resolve_profile(profile.as_ref());
            Ok(IrOperation::MoveTo {
                origin: id.clone(),
                pose: ResolvedPose {
                    position: point.pose.position,
                    orientation: point.pose.orientation,
                    frame: world_frame(),
                },
                profile: resolved_profile,
            })
        }
        Operation::Follow { id, path, profile } => {
            let path_def = resolve_path_def(path, resources)?;
            let resolved_profile = resolve_profile(profile.as_ref());
            let waypoints: Vec<ResolvedPose> = path_def
                .points
                .iter()
                .map(|point_id| resolve_point_to_pose(point_id, resources))
                .collect::<Result<Vec<_>, _>>()?;

            if waypoints.is_empty() {
                return Err(NormalizationError::EmptyPath(
                    path_def.id.as_str().to_string(),
                ));
            }

            Ok(IrOperation::Follow {
                origin: id.clone(),
                waypoints,
                profile: resolved_profile,
            })
        }
        Operation::Wait { id, duration } => Ok(IrOperation::Wait {
            origin: id.clone(),
            duration: *duration,
        }),
        Operation::SetOutput { id, channel, value } => {
            let output = resolve_output_def(channel, resources)?;
            Ok(IrOperation::SetOutput {
                origin: id.clone(),
                channel: ResolvedOutput {
                    name: output.name.clone(),
                    channel_type: output.channel_type.clone(),
                },
                value: value.clone(),
            })
        }
    }
}

fn resolve_point<'a>(
    id: &PointId,
    resources: &'a Resources,
) -> Result<&'a thalos_document::resource::Point, NormalizationError> {
    resources
        .points
        .iter()
        .find(|p| p.id == *id)
        .ok_or_else(|| NormalizationError::UnresolvedPoint(id.to_string()))
}

fn resolve_point_to_pose(
    id: &PointId,
    resources: &Resources,
) -> Result<ResolvedPose, NormalizationError> {
    let point = resolve_point(id, resources)?;
    Ok(ResolvedPose {
        position: point.pose.position,
        orientation: point.pose.orientation,
        frame: world_frame(),
    })
}

fn resolve_path_def<'a>(
    id: &PathId,
    resources: &'a Resources,
) -> Result<&'a thalos_document::resource::Path, NormalizationError> {
    resources
        .paths
        .iter()
        .find(|p| p.id == *id)
        .ok_or_else(|| NormalizationError::UnresolvedPath(id.to_string()))
}

fn resolve_output_def<'a>(
    id: &OutputId,
    resources: &'a Resources,
) -> Result<&'a thalos_document::resource::Output, NormalizationError> {
    resources
        .outputs
        .iter()
        .find(|o| o.id == *id)
        .ok_or_else(|| NormalizationError::UnresolvedOutput(id.to_string()))
}

fn resolve_profile(profile: Option<&MotionProfile>) -> ResolvedProfile {
    let profile = profile.unwrap_or(&MotionProfile::Default);
    match profile {
        MotionProfile::Default => ResolvedProfile {
            name: "default".into(),
            velocity: DEFAULT_VELOCITY,
            acceleration: DEFAULT_ACCELERATION,
        },
        MotionProfile::Named(name) => ResolvedProfile {
            name: name.clone(),
            velocity: DEFAULT_VELOCITY,
            acceleration: DEFAULT_ACCELERATION,
        },
    }
}

fn world_frame() -> ResolvedFrame {
    ResolvedFrame {
        name: "world".into(),
        parent: String::new(),
        transform: IDENTITY_4X4,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use thalos_document::operation::Operation;
    use thalos_document::operation::io::OutputValue;
    use thalos_document::operation::motion::MotionProfile;
    use thalos_document::pose::Pose;
    use thalos_document::project::{Metadata, Project, Robot, Scene, Settings, Task};
    use thalos_document::resource::*;
    use thalos_document::validation::validate_structural;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn minimal_project() -> Project {
        Project {
            metadata: Metadata {
                name: "test".into(),
                version: 1,
                created_at: "2026-07-27T00:00:00Z".into(),
                modified_at: "2026-07-27T00:00:00Z".into(),
            },
            robot: Robot {
                reference: "ur5e".into(),
            },
            scene: Scene {
                reference: "workshop".into(),
            },
            resources: Resources {
                points: vec![],
                paths: vec![],
                frames: vec![],
                outputs: vec![],
            },
            tasks: vec![Task {
                id: "task_1".into(),
                operations: vec![],
            }],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        }
    }

    fn add_point(project: &mut Project, id: &str, pos: [f64; 3], orient: [f64; 4]) {
        project.resources.points.push(Point {
            id: PointId(id.into()),
            name: id.into(),
            pose: Pose {
                position: pos,
                orientation: orient,
            },
        });
    }

    fn add_path(project: &mut Project, id: &str, point_ids: &[&str]) {
        project.resources.paths.push(Path {
            id: PathId(id.into()),
            name: id.into(),
            points: point_ids.iter().map(|p| PointId(p.to_string())).collect(),
        });
    }

    fn add_output(project: &mut Project, id: &str, channel_type: &str) {
        project.resources.outputs.push(Output {
            id: OutputId(id.into()),
            name: id.into(),
            channel_type: channel_type.into(),
        });
    }

    // -----------------------------------------------------------------------
    // 3.1 — IrMoveTo contains concrete ResolvedPose from PointId
    // -----------------------------------------------------------------------

    #[test]
    fn move_to_resolves_point_id_to_concrete_pose() {
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [1.0, 2.0, 3.0], [0.0, 0.0, 0.0, 1.0]);
        project.tasks[0].operations.push(Operation::MoveTo {
            id: OperationId("op_1".into()),
            target: PointId("pt_01".into()),
            profile: None,
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        assert_eq!(program.operations.len(), 1);
        match &program.operations[0] {
            IrOperation::MoveTo {
                origin,
                pose,
                profile,
            } => {
                assert_eq!(origin.as_str(), "op_1");
                assert_eq!(pose.position, [1.0, 2.0, 3.0]);
                assert_eq!(pose.orientation, [0.0, 0.0, 0.0, 1.0]);
                assert_eq!(pose.frame.name, "world");
                assert_eq!(profile.name, "default");
                assert_eq!(profile.velocity, 0.5);
                assert_eq!(profile.acceleration, 1.0);
            }
            _ => panic!("Expected IrOperation::MoveTo"),
        }
    }

    // -----------------------------------------------------------------------
    // 3.2 — IrFollow has >= 1 waypoint from PathId
    // -----------------------------------------------------------------------

    #[test]
    fn follow_expands_path_to_waypoints() {
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]);
        add_point(&mut project, "pt_02", [1.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]);
        add_point(&mut project, "pt_03", [2.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]);
        add_path(&mut project, "weld_path", &["pt_01", "pt_02", "pt_03"]);
        project.tasks[0].operations.push(Operation::Follow {
            id: OperationId("op_2".into()),
            path: PathId("weld_path".into()),
            profile: None,
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        assert_eq!(program.operations.len(), 1);
        match &program.operations[0] {
            IrOperation::Follow {
                origin,
                waypoints,
                profile,
            } => {
                assert_eq!(origin.as_str(), "op_2");
                assert_eq!(waypoints.len(), 3);
                assert_eq!(waypoints[0].position, [0.0, 0.0, 0.0]);
                assert_eq!(waypoints[1].position, [1.0, 0.0, 0.0]);
                assert_eq!(waypoints[2].position, [2.0, 0.0, 0.0]);
                assert_eq!(profile.name, "default");
            }
            _ => panic!("Expected IrOperation::Follow"),
        }
    }

    // -----------------------------------------------------------------------
    // 3.3 — IrHome retains originating OperationId
    // -----------------------------------------------------------------------

    #[test]
    fn home_retains_operation_id() {
        let mut project = minimal_project();
        project.tasks[0].operations.push(Operation::Home {
            id: OperationId("op_42".into()),
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        assert_eq!(program.operations.len(), 1);
        match &program.operations[0] {
            IrOperation::Home { origin } => {
                assert_eq!(origin.as_str(), "op_42");
            }
            _ => panic!("Expected IrOperation::Home"),
        }
    }

    // -----------------------------------------------------------------------
    // 3.4 — Every normalized operation preserves source OperationId
    // -----------------------------------------------------------------------

    #[test]
    fn all_operations_preserve_origin_traceability() {
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [0.0; 3], [0.0, 0.0, 0.0, 1.0]);
        add_path(&mut project, "path_1", &["pt_01"]);
        add_output(&mut project, "gripper", "digital");

        project.tasks[0].operations = vec![
            Operation::Home {
                id: OperationId("op_1".into()),
            },
            Operation::MoveTo {
                id: OperationId("op_2".into()),
                target: PointId("pt_01".into()),
                profile: None,
            },
            Operation::Follow {
                id: OperationId("op_3".into()),
                path: PathId("path_1".into()),
                profile: None,
            },
            Operation::Wait {
                id: OperationId("op_4".into()),
                duration: Duration::from_secs(3),
            },
            Operation::SetOutput {
                id: OperationId("op_5".into()),
                channel: OutputId("gripper".into()),
                value: OutputValue::Bool(true),
            },
        ];

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        assert_eq!(program.operations.len(), 5);
        let origins: Vec<&str> = program
            .operations
            .iter()
            .map(|op| match op {
                IrOperation::Home { origin }
                | IrOperation::MoveTo { origin, .. }
                | IrOperation::Follow { origin, .. }
                | IrOperation::Wait { origin, .. }
                | IrOperation::SetOutput { origin, .. } => origin.as_str(),
            })
            .collect();
        assert_eq!(origins, vec!["op_1", "op_2", "op_3", "op_4", "op_5"]);
    }

    // -----------------------------------------------------------------------
    // 3.5 — Default profile / frame applied when operation field is None
    // -----------------------------------------------------------------------

    #[test]
    fn default_profile_applied_when_none() {
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [0.5, 0.0, 0.3], [0.0, 0.0, 0.0, 1.0]);
        project.tasks[0].operations.push(Operation::MoveTo {
            id: OperationId("op_1".into()),
            target: PointId("pt_01".into()),
            profile: None,
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        match &program.operations[0] {
            IrOperation::MoveTo { profile, pose, .. } => {
                assert_eq!(profile.name, "default");
                assert_eq!(profile.velocity, 0.5);
                assert_eq!(profile.acceleration, 1.0);
                assert_eq!(pose.frame.name, "world");
                assert_eq!(pose.frame.parent, "");
                assert_eq!(
                    pose.frame.transform,
                    [
                        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
                        1.0
                    ]
                );
            }
            _ => panic!("Expected IrOperation::MoveTo"),
        }
    }

    #[test]
    fn named_profile_resolves_to_concrete_limits() {
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [0.0; 3], [0.0, 0.0, 0.0, 1.0]);
        project.tasks[0].operations.push(Operation::MoveTo {
            id: OperationId("op_1".into()),
            target: PointId("pt_01".into()),
            profile: Some(MotionProfile::Named("slow".into())),
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        match &program.operations[0] {
            IrOperation::MoveTo { profile, .. } => {
                assert_eq!(profile.name, "slow");
                assert!(profile.velocity > 0.0);
                assert!(profile.acceleration > 0.0);
            }
            _ => panic!("Expected IrOperation::MoveTo"),
        }
    }

    // -----------------------------------------------------------------------
    // 3.6 — Deterministic: same Project produces identical IrProgram
    // -----------------------------------------------------------------------

    #[test]
    fn normalize_is_deterministic() {
        let mut project = minimal_project();
        add_point(
            &mut project,
            "pt_01",
            [1.5, -0.5, 2.0],
            [0.0, 0.0, 0.0, 1.0],
        );
        add_path(&mut project, "path_1", &["pt_01"]);
        project.tasks[0].operations = vec![
            Operation::Home {
                id: OperationId("op_1".into()),
            },
            Operation::MoveTo {
                id: OperationId("op_2".into()),
                target: PointId("pt_01".into()),
                profile: None,
            },
            Operation::Wait {
                id: OperationId("op_3".into()),
                duration: Duration::from_millis(500),
            },
        ];

        let proof = validate_structural(&project).expect("valid structural");
        let a = normalize(&project, &proof).expect("normalize pass 1");
        let b = normalize(&project, &proof).expect("normalize pass 2");

        let json_a = serde_json::to_string(&a).expect("serialize a");
        let json_b = serde_json::to_string(&b).expect("serialize b");
        assert_eq!(json_a, json_b, "IrProgram must be byte-identical");
    }

    // -----------------------------------------------------------------------
    // 3.7 — Negative tests: each NormalizationError variant fires correctly
    // -----------------------------------------------------------------------

    #[test]
    fn unresolved_point_returns_error() {
        let mut project = minimal_project();
        project.tasks[0].operations.push(Operation::MoveTo {
            id: OperationId("op_1".into()),
            target: PointId("pt_999".into()),
            profile: None,
        });

        let proof = validate_structural(&project).expect("valid structural");
        let result = normalize(&project, &proof);

        match result {
            Err(NormalizationError::UnresolvedPoint(id)) => {
                assert_eq!(id, "pt_999");
            }
            other => panic!("Expected UnresolvedPoint, got {other:?}"),
        }
    }

    #[test]
    fn unresolved_path_returns_error() {
        let mut project = minimal_project();
        project.tasks[0].operations.push(Operation::Follow {
            id: OperationId("op_1".into()),
            path: PathId("path_404".into()),
            profile: None,
        });

        let proof = validate_structural(&project).expect("valid structural");
        let result = normalize(&project, &proof);

        match result {
            Err(NormalizationError::UnresolvedPath(id)) => {
                assert_eq!(id, "path_404");
            }
            other => panic!("Expected UnresolvedPath, got {other:?}"),
        }
    }

    #[test]
    fn empty_path_returns_error() {
        let mut project = minimal_project();
        add_path(&mut project, "empty_path", &[]);
        project.tasks[0].operations.push(Operation::Follow {
            id: OperationId("op_1".into()),
            path: PathId("empty_path".into()),
            profile: None,
        });

        let proof = validate_structural(&project).expect("valid structural");
        let result = normalize(&project, &proof);

        match result {
            Err(NormalizationError::EmptyPath(id)) => {
                assert_eq!(id, "empty_path");
            }
            other => panic!("Expected EmptyPath, got {other:?}"),
        }
    }

    #[test]
    fn unresolved_output_returns_error() {
        let mut project = minimal_project();
        project.tasks[0].operations.push(Operation::SetOutput {
            id: OperationId("op_1".into()),
            channel: OutputId("no_such_output".into()),
            value: OutputValue::Bool(false),
        });

        let proof = validate_structural(&project).expect("valid structural");
        let result = normalize(&project, &proof);

        match result {
            Err(NormalizationError::UnresolvedOutput(id)) => {
                assert_eq!(id, "no_such_output");
            }
            other => panic!("Expected UnresolvedOutput, got {other:?}"),
        }
    }

    // -----------------------------------------------------------------------
    // 3.8 — Integration: Project JSON → normalize → IrProgram JSON round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn project_json_round_trip_through_normalize() {
        // Build a Project with all operation types
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [0.5, 0.0, 0.3], [0.0, 0.0, 0.0, 1.0]);
        add_point(&mut project, "pt_02", [1.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]);
        add_path(&mut project, "weld", &["pt_01", "pt_02"]);
        add_output(&mut project, "gripper", "digital");

        project.tasks[0].operations = vec![
            Operation::Home {
                id: OperationId("op_1".into()),
            },
            Operation::MoveTo {
                id: OperationId("op_2".into()),
                target: PointId("pt_01".into()),
                profile: None,
            },
            Operation::Follow {
                id: OperationId("op_3".into()),
                path: PathId("weld".into()),
                profile: Some(MotionProfile::Named("fast".into())),
            },
            Operation::Wait {
                id: OperationId("op_4".into()),
                duration: Duration::from_secs(2),
            },
            Operation::SetOutput {
                id: OperationId("op_5".into()),
                channel: OutputId("gripper".into()),
                value: OutputValue::Bool(true),
            },
        ];

        // Serialize project to JSON, normalize, verify program survives serde
        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        let json = serde_json::to_string(&program).expect("serialize IrProgram");
        let deserialized: IrProgram = serde_json::from_str(&json).expect("deserialize IrProgram");

        assert_eq!(program, deserialized);
        assert_eq!(deserialized.operations.len(), 5);

        // Verify structural invariants in deserialized program
        for op in &deserialized.operations {
            match op {
                IrOperation::MoveTo { pose, .. } => {
                    assert_eq!(pose.frame.name, "world");
                }
                IrOperation::Follow { waypoints, .. } => {
                    assert!(!waypoints.is_empty(), "IrFollow must have waypoints");
                }
                _ => {}
            }
        }
    }

    // -----------------------------------------------------------------------
    // Edge cases and triangulation
    // -----------------------------------------------------------------------

    #[test]
    fn move_to_with_explicit_profile_default() {
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [0.0; 3], [0.0, 0.0, 0.0, 1.0]);
        project.tasks[0].operations.push(Operation::MoveTo {
            id: OperationId("op_1".into()),
            target: PointId("pt_01".into()),
            profile: Some(MotionProfile::Default),
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        match &program.operations[0] {
            IrOperation::MoveTo { profile, .. } => {
                assert_eq!(profile.name, "default");
                assert_eq!(profile.velocity, 0.5);
            }
            _ => panic!("Expected IrOperation::MoveTo"),
        }
    }

    #[test]
    fn multiple_tasks_operations_in_document_order() {
        let mut project = minimal_project();
        add_point(&mut project, "pt_01", [0.0; 3], [0.0, 0.0, 0.0, 1.0]);
        project.tasks[0].operations.push(Operation::Home {
            id: OperationId("op_1".into()),
        });
        project.tasks.push(Task {
            id: "task_2".into(),
            operations: vec![Operation::MoveTo {
                id: OperationId("op_2".into()),
                target: PointId("pt_01".into()),
                profile: None,
            }],
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        assert_eq!(program.operations.len(), 2);
        assert!(matches!(program.operations[0], IrOperation::Home { .. }));
        assert!(matches!(program.operations[1], IrOperation::MoveTo { .. }));
    }

    #[test]
    fn empty_project_produces_empty_program() {
        let project = minimal_project();

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        assert!(program.operations.is_empty());
        assert_eq!(program.version, 1);
        assert_eq!(program.source_metadata.name, "test");
    }

    #[test]
    fn program_metadata_preserved() {
        let mut project = minimal_project();
        project.tasks[0].operations.push(Operation::Home {
            id: OperationId("op_1".into()),
        });

        let proof = validate_structural(&project).expect("valid structural");
        let program = normalize(&project, &proof).expect("normalize");

        assert_eq!(program.source_metadata.name, "test");
        assert_eq!(program.source_metadata.version, 1);
    }
}
