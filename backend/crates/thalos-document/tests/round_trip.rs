//! Round-trip integration tests for the full Project serialization.
//!
//! Two goals:
//! 1. Serialize → deserialize → equality (model identity).
//! 2. JSON equivalence: Project → JSON → Project → JSON produces identical strings.

use std::time::Duration;
use thalos_document::prelude::*;

/// Build a comprehensive Project exercising all five operation types.
fn full_project() -> Project {
    Project {
        metadata: Metadata {
            name: "roundtrip_test".to_string(),
            version: 1,
            created_at: "2026-07-27T00:00:00Z".to_string(),
            modified_at: "2026-07-27T00:00:00Z".to_string(),
        },
        robot: Robot {
            reference: "ur5e".to_string(),
        },
        scene: Scene {
            reference: "workshop".to_string(),
        },
        resources: Resources {
            points: vec![
                Point {
                    id: PointId("pt_01".to_string()),
                    name: "pick".to_string(),
                    pose: Pose {
                        position: [0.5, 0.0, 0.3],
                        orientation: [0.0, 0.0, 0.0, 1.0],
                    },
                },
                Point {
                    id: PointId("pt_02".to_string()),
                    name: "place".to_string(),
                    pose: Pose {
                        position: [-0.3, 0.4, 0.2],
                        orientation: [0.0, 0.0, 0.707, 0.707],
                    },
                },
            ],
            paths: vec![Path {
                id: PathId("path_1".to_string()),
                name: "Weld".to_string(),
                points: vec![PointId("pt_01".to_string()), PointId("pt_02".to_string())],
            }],
            frames: vec![],
            outputs: vec![
                Output {
                    id: OutputId("gripper".to_string()),
                    name: "Gripper".to_string(),
                    channel_type: "digital".to_string(),
                },
                Output {
                    id: OutputId("valve".to_string()),
                    name: "Valve".to_string(),
                    channel_type: "analog".to_string(),
                },
            ],
            objects: vec![],
            locations: vec![],
            tools: vec![],
        },
        tasks: vec![Task::geometric(
            "main",
            vec![
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
                    profile: Some(MotionProfile::Named("slow".to_string())),
                },
                Operation::Wait {
                    id: OperationId("op_4".to_string()),
                    duration: Duration::from_secs(3),
                },
                Operation::SetOutput {
                    id: OperationId("op_5".to_string()),
                    channel: OutputId("gripper".to_string()),
                    value: OutputValue::Bool(true),
                },
                Operation::SetOutput {
                    id: OperationId("op_6".to_string()),
                    channel: OutputId("valve".to_string()),
                    value: OutputValue::Float(0.75),
                },
            ],
        )],
        settings: Settings {
            default_profile: MotionProfile::Default,
        },
    }
}

// ---------------------------------------------------------------------------
// Model identity: serialize → deserialize → equality
// ---------------------------------------------------------------------------

#[test]
fn round_trip_preserves_model() {
    let original = full_project();
    let json = serde_json::to_string(&original).expect("serialize");
    let deserialized: Project = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(original, deserialized);
}

// ---------------------------------------------------------------------------
// JSON equivalence: Project → JSON → Project → JSON → compare strings
// ---------------------------------------------------------------------------

#[test]
fn round_trip_json_equivalence() {
    let original = full_project();
    let json_a = serde_json::to_string(&original).expect("serialize (1st)");
    let deserialized: Project = serde_json::from_str(&json_a).expect("deserialize");
    let json_b = serde_json::to_string(&deserialized).expect("serialize (2nd)");
    assert_eq!(json_a, json_b, "JSON should be identical after round-trip");
}

// ---------------------------------------------------------------------------
// Forward-compat: deserialize from known-good v1 fixture
// ---------------------------------------------------------------------------

#[test]
fn forward_compat_deserialize_v1_fixture() {
    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/v1_project.json"
    );
    let json = std::fs::read_to_string(fixture_path).expect("read fixture file");
    let project: Project = serde_json::from_str(&json).expect("deserialize fixture");

    // Verify metadata
    assert_eq!(project.metadata.name, "test_project");
    assert_eq!(project.metadata.version, 1);

    // Verify resources
    assert_eq!(project.resources.points.len(), 2);
    assert_eq!(project.resources.paths.len(), 1);
    assert_eq!(project.resources.outputs.len(), 2);

    // Verify tasks
    assert_eq!(project.tasks.len(), 1);
    assert_eq!(project.tasks[0].id, "main");
    assert_eq!(project.tasks[0].operation_count(), 6);

    let ops = project.tasks[0]
        .kind
        .geometric_operations()
        .expect("fixture should be geometric");
    assert!(matches!(ops[0], Operation::Home { .. }));
    assert!(matches!(ops[1], Operation::MoveTo { .. }));
    assert!(matches!(ops[2], Operation::MoveTo { .. }));
    assert!(matches!(ops[3], Operation::Wait { .. }));
    assert!(matches!(ops[4], Operation::SetOutput { .. }));
    assert!(matches!(ops[5], Operation::SetOutput { .. }));

    // Verify settings
    assert_eq!(
        project.settings.default_profile,
        MotionProfile::Named("standard".to_string())
    );
}

// ---------------------------------------------------------------------------
// Unknown fields are tolerated (serde deny_unknown_fields is not set)
// ---------------------------------------------------------------------------

#[test]
fn unknown_fields_are_tolerated() {
    let json = r#"{
        "metadata": {
            "name": "compat",
            "version": 1,
            "created_at": "2026-01-01T00:00:00Z",
            "modified_at": "2026-01-01T00:00:00Z"
        },
        "robot": { "reference": "r" },
        "scene": { "reference": "s" },
        "resources": { "points": [], "paths": [], "frames": [], "outputs": [] },
        "tasks": [],
        "settings": { "default_profile": "default" },
        "redundant_field": true
    }"#;
    let project: Project = serde_json::from_str(json).expect("deserialize with unknown fields");
    assert_eq!(project.metadata.name, "compat");
}
