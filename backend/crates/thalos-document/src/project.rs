use crate::operation::motion::MotionProfile;
use crate::operation::Operation;
use crate::resource::Resources;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Root document types — Project is the top-level task document.
// ---------------------------------------------------------------------------

/// Document identity and versioning — describes the document itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Metadata {
    /// Human-readable project name.
    pub name: String,
    /// Monotonically increasing document version.
    pub version: u32,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last-modified timestamp.
    pub modified_at: String,
}

/// Robot reference — identifies the target robot platform.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Robot {
    /// Robot identifier or URDF path / model name.
    pub reference: String,
}

/// Scene / environment reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scene {
    /// Scene identifier or environment name.
    pub reference: String,
}

/// Execution defaults applied when operations omit optional parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Default motion profile used when an operation does not specify one.
    pub default_profile: MotionProfile,
}

/// A single task — a named, ordered collection of operations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Task {
    /// Unique task identifier within the project.
    pub id: String,
    /// Ordered list of operations composing this task.
    pub operations: Vec<Operation>,
}

/// Root task document — the top-level serializable model.
///
/// Contains exactly six sections: metadata, robot, scene, resources, tasks,
/// and settings. All sections are required.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub metadata: Metadata,
    pub robot: Robot,
    pub scene: Scene,
    pub resources: Resources,
    pub tasks: Vec<Task>,
    pub settings: Settings,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::*;
    use crate::operation::io::OutputValue;
    use crate::operation::motion::MotionProfile;
    use crate::operation::Operation;
    use crate::pose::Pose;
    use crate::resource::*;
    use std::time::Duration;

    // --- Metadata construction ---

    #[test]
    fn metadata_construction() {
        let meta = Metadata {
            name: "test_project".to_string(),
            version: 1,
            created_at: "2026-07-27T00:00:00Z".to_string(),
            modified_at: "2026-07-27T00:00:00Z".to_string(),
        };
        assert_eq!(meta.name, "test_project");
        assert_eq!(meta.version, 1);
        assert!(!meta.created_at.is_empty());
    }

    // --- Minimal project construction ---

    #[test]
    fn minimal_project_all_six_sections() {
        let project = Project {
            metadata: Metadata {
                name: "minimal".to_string(),
                version: 1,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                modified_at: "2026-01-01T00:00:00Z".to_string(),
            },
            robot: Robot {
                reference: "ur5e".to_string(),
            },
            scene: Scene {
                reference: "default_scene".to_string(),
            },
            resources: Resources {
                points: vec![],
                paths: vec![],
                frames: vec![],
                outputs: vec![],
            },
            tasks: vec![Task {
                id: "task_1".to_string(),
                operations: vec![Operation::Home {
                    id: OperationId("op_1".to_string()),
                }],
            }],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        };
        assert_eq!(project.metadata.name, "minimal");
        assert_eq!(project.robot.reference, "ur5e");
        assert_eq!(project.scene.reference, "default_scene");
        assert_eq!(project.resources.points.len(), 0);
        assert_eq!(project.tasks.len(), 1);
    }

    // --- Multiple tasks preserve order ---

    #[test]
    fn multiple_tasks_preserve_order() {
        let project = Project {
            metadata: Metadata {
                name: "ordered".to_string(),
                version: 1,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                modified_at: "2026-01-01T00:00:00Z".to_string(),
            },
            robot: Robot {
                reference: "robot".to_string(),
            },
            scene: Scene {
                reference: "scene".to_string(),
            },
            resources: Resources {
                points: vec![],
                paths: vec![],
                frames: vec![],
                outputs: vec![],
            },
            tasks: vec![
                Task {
                    id: "first".to_string(),
                    operations: vec![],
                },
                Task {
                    id: "second".to_string(),
                    operations: vec![],
                },
                Task {
                    id: "third".to_string(),
                    operations: vec![],
                },
            ],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        };
        assert_eq!(project.tasks.len(), 3);
        assert_eq!(project.tasks[0].id, "first");
        assert_eq!(project.tasks[1].id, "second");
        assert_eq!(project.tasks[2].id, "third");
    }

    // --- Project with mixed operations ---

    #[test]
    fn project_with_mixed_operations() {
        let project = Project {
            metadata: Metadata {
                name: "demo".to_string(),
                version: 1,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                modified_at: "2026-01-01T00:00:00Z".to_string(),
            },
            robot: Robot {
                reference: "ur5e".to_string(),
            },
            scene: Scene {
                reference: "workshop".to_string(),
            },
            resources: Resources {
                points: vec![Point {
                    id: PointId("pt_01".to_string()),
                    name: "pick".to_string(),
                    pose: Pose {
                        position: [0.5, 0.0, 0.3],
                        orientation: [0.0, 0.0, 0.0, 1.0],
                    },
                }],
                paths: vec![],
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
                    Operation::Wait {
                        id: OperationId("op_3".to_string()),
                        duration: Duration::from_millis(500),
                    },
                    Operation::SetOutput {
                        id: OperationId("op_4".to_string()),
                        channel: OutputId("gripper".to_string()),
                        value: OutputValue::Bool(true),
                    },
                ],
            }],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        };
        assert_eq!(project.tasks[0].operations.len(), 4);
    }

    // --- Project serde round-trip ---

    #[test]
    fn project_serde_round_trip() {
        let original = Project {
            metadata: Metadata {
                name: "roundtrip".to_string(),
                version: 1,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                modified_at: "2026-01-01T00:00:00Z".to_string(),
            },
            robot: Robot {
                reference: "robot".to_string(),
            },
            scene: Scene {
                reference: "scene".to_string(),
            },
            resources: Resources {
                points: vec![Point {
                    id: PointId("pt_01".to_string()),
                    name: "A".to_string(),
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
                operations: vec![Operation::Home {
                    id: OperationId("op_1".to_string()),
                }],
            }],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        };
        let json = serde_json::to_string(&original).expect("serialize");
        assert!(json.contains(r#""metadata""#));
        assert!(json.contains(r#""robot""#));
        assert!(json.contains(r#""scene""#));
        assert!(json.contains(r#""resources""#));
        assert!(json.contains(r#""tasks""#));
        assert!(json.contains(r#""settings""#));
        let deserialized: Project = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    // --- Clone and Debug ---

    #[test]
    fn project_is_clone_and_debug() {
        let a = Project {
            metadata: Metadata {
                name: "test".to_string(),
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
                points: vec![],
                paths: vec![],
                frames: vec![],
                outputs: vec![],
            },
            tasks: vec![],
            settings: Settings {
                default_profile: MotionProfile::Default,
            },
        };
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{:?}", a);
    }
}
