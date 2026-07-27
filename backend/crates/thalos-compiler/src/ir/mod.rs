pub mod types;

pub use types::*;

use serde::{Deserialize, Serialize};
use std::time::Duration;
use thalos_document::id::OperationId;
use thalos_document::operation::io::OutputValue;
use thalos_document::project::Metadata as ProjectMetadata;

/// A fully resolved, robot-agnostic intermediate representation of a task program.
///
/// The IR contains no unresolved references — every resource has been resolved
/// to concrete values. It is structurally complete, serialisable, and serves as
/// the boundary between "user document" and "backend lowering."
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IrProgram {
    /// Schema version for forward-compatibility checks.
    pub version: u32,
    /// Ordered list of resolved operations.
    pub operations: Vec<IrOperation>,
    /// Source document metadata for provenance and diagnostics.
    pub source_metadata: ProjectMetadata,
}

/// Primitive IR operations — fully resolved, no references.
///
/// Mirrors the five document `Operation` variants but replaces all resource
/// references (`PointId`, `PathId`, `FrameId`, `OutputId`) with their resolved
/// concrete types. Serialized as `{"type": "<snake_case_name>", ...fields...}`
/// matching the document convention.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IrOperation {
    /// Return robot to configured home position.
    Home {
        origin: OperationId,
    },
    /// Move to a target pose with a concrete motion profile.
    MoveTo {
        origin: OperationId,
        pose: ResolvedPose,
        profile: ResolvedProfile,
    },
    /// Follow an ordered sequence of waypoints.
    Follow {
        origin: OperationId,
        waypoints: Vec<ResolvedPose>,
        profile: ResolvedProfile,
    },
    /// Pause execution for the given duration.
    Wait {
        origin: OperationId,
        duration: Duration,
    },
    /// Set an output channel to a typed value.
    SetOutput {
        origin: OperationId,
        channel: ResolvedOutput,
        value: OutputValue,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use thalos_document::id::OperationId;
    use thalos_document::operation::io::OutputValue;
    use thalos_document::project::Metadata as ProjectMetadata;

    // -----------------------------------------------------------------------
    // 1.4 / 1.8 — IR type construction
    // -----------------------------------------------------------------------

    #[test]
    fn ir_program_empty() {
        let meta = ProjectMetadata {
            name: "test".into(),
            version: 1,
            created_at: "2026-07-27T00:00:00Z".into(),
            modified_at: "2026-07-27T00:00:00Z".into(),
        };
        let program = IrProgram {
            version: 1,
            operations: vec![],
            source_metadata: meta.clone(),
        };
        assert_eq!(program.version, 1);
        assert!(program.operations.is_empty());
        assert_eq!(program.source_metadata, meta);
    }

    #[test]
    fn ir_operation_home_construction() {
        let op = IrOperation::Home {
            origin: OperationId("op_1".into()),
        };
        assert!(matches!(op, IrOperation::Home { .. }));
    }

    #[test]
    fn ir_operation_move_to_construction() {
        let op = IrOperation::MoveTo {
            origin: OperationId("op_2".into()),
            pose: ResolvedPose {
                position: [0.5, 0.0, 0.3],
                orientation: [0.0, 0.0, 0.0, 1.0],
                frame: ResolvedFrame {
                    name: "base".into(),
                    parent: "world".into(),
                    transform: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                },
            },
            profile: ResolvedProfile {
                name: "default".into(),
                velocity: 1.0,
                acceleration: 2.0,
            },
        };
        assert!(matches!(op, IrOperation::MoveTo { .. }));
    }

    #[test]
    fn ir_operation_follow_construction() {
        let waypoint = ResolvedPose {
            position: [0.0, 0.0, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: ResolvedFrame {
                name: "base".into(),
                parent: "world".into(),
                transform: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            },
        };
        let op = IrOperation::Follow {
            origin: OperationId("op_3".into()),
            waypoints: vec![waypoint],
            profile: ResolvedProfile {
                name: "fast".into(),
                velocity: 2.0,
                acceleration: 4.0,
            },
        };
        assert!(matches!(op, IrOperation::Follow { .. }));
    }

    #[test]
    fn ir_operation_wait_construction() {
        let op = IrOperation::Wait {
            origin: OperationId("op_4".into()),
            duration: Duration::from_secs(5),
        };
        assert!(matches!(op, IrOperation::Wait { .. }));
    }

    #[test]
    fn ir_operation_set_output_construction() {
        let op = IrOperation::SetOutput {
            origin: OperationId("op_5".into()),
            channel: ResolvedOutput {
                name: "Gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        };
        assert!(matches!(op, IrOperation::SetOutput { .. }));
    }

    // -----------------------------------------------------------------------
    // 1.8 — Serde round-trip preserves program
    // -----------------------------------------------------------------------

    fn sample_program() -> IrProgram {
        IrProgram {
            version: 1,
            operations: vec![
                IrOperation::Home {
                    origin: OperationId("op_1".into()),
                },
                IrOperation::MoveTo {
                    origin: OperationId("op_2".into()),
                    pose: ResolvedPose {
                        position: [0.5, 0.0, 0.3],
                        orientation: [0.0, 0.0, 0.0, 1.0],
                        frame: ResolvedFrame {
                            name: "base".into(),
                            parent: "world".into(),
                            transform: IDENTITY_4X4,
                        },
                    },
                    profile: ResolvedProfile {
                        name: "default".into(),
                        velocity: 1.0,
                        acceleration: 2.0,
                    },
                },
                IrOperation::Follow {
                    origin: OperationId("op_3".into()),
                    waypoints: vec![
                        ResolvedPose {
                            position: [0.0, 0.0, 0.0],
                            orientation: [0.0, 0.0, 0.0, 1.0],
                            frame: ResolvedFrame {
                                name: "base".into(),
                                parent: "world".into(),
                                transform: IDENTITY_4X4,
                            },
                        },
                    ],
                    profile: ResolvedProfile {
                        name: "fast".into(),
                        velocity: 2.0,
                        acceleration: 4.0,
                    },
                },
                IrOperation::Wait {
                    origin: OperationId("op_4".into()),
                    duration: Duration::from_millis(500),
                },
                IrOperation::SetOutput {
                    origin: OperationId("op_5".into()),
                    channel: ResolvedOutput {
                        name: "Gripper".into(),
                        channel_type: "digital".into(),
                    },
                    value: OutputValue::Integer(255),
                },
            ],
            source_metadata: ProjectMetadata {
                name: "roundtrip_test".into(),
                version: 1,
                created_at: "2026-07-27T00:00:00Z".into(),
                modified_at: "2026-07-27T00:00:00Z".into(),
            },
        }
    }

    const IDENTITY_4X4: [f64; 16] = [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ];

    #[test]
    fn ir_program_serde_round_trip_all_operations() {
        let original = sample_program();
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: IrProgram = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    #[test]
    fn ir_program_serde_preserves_operation_count() {
        let original = sample_program();
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: IrProgram = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.operations.len(), 5);
    }

    #[test]
    fn ir_program_serde_type_tag_home() {
        let original = sample_program();
        let json = serde_json::to_string(&original).expect("serialize");
        assert!(json.contains(r#""type":"home""#));
        assert!(json.contains(r#""type":"move_to""#));
        assert!(json.contains(r#""type":"follow""#));
        assert!(json.contains(r#""type":"wait""#));
        assert!(json.contains(r#""type":"set_output""#));
    }

    #[test]
    fn ir_program_empty_operations_round_trip() {
        let original = IrProgram {
            version: 2,
            operations: vec![],
            source_metadata: ProjectMetadata {
                name: "empty".into(),
                version: 2,
                created_at: "2026-07-27T00:00:00Z".into(),
                modified_at: "2026-07-27T00:00:00Z".into(),
            },
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: IrProgram = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    // -----------------------------------------------------------------------
    // 1.9 — IR invariants
    // -----------------------------------------------------------------------

    #[test]
    fn ir_operation_no_unresolved_refs() {
        // The type system enforces that IrOperation never contains unresolved
        // resource references. ResolvedPose (concrete position/orientation/frame)
        // replaces PointId; ResolvedProfile (concrete velocity/acceleration)
        // replaces MotionProfile/string; ResolvedOutput replaces OutputId.
        //
        // This test constructs every variant and verifies they hold concrete
        // values — NOT identifiers that require a lookup.
        let home = IrOperation::Home {
            origin: OperationId("op_1".into()),
        };
        let move_to = IrOperation::MoveTo {
            origin: OperationId("op_2".into()),
            pose: ResolvedPose {
                position: [1.0, 0.0, 0.0],
                orientation: [0.0, 0.0, 0.0, 1.0],
                frame: make_frame("base", "world"),
            },
            profile: make_profile("default", 1.0, 2.0),
        };
        let _follow = IrOperation::Follow {
            origin: OperationId("op_3".into()),
            waypoints: vec![ResolvedPose {
                position: [0.0, 0.0, 0.0],
                orientation: [0.0, 0.0, 0.0, 1.0],
                frame: make_frame("base", "world"),
            }],
            profile: make_profile("default", 1.0, 2.0),
        };
        let wait = IrOperation::Wait {
            origin: OperationId("op_4".into()),
            duration: Duration::from_secs(1),
        };
        let set_output = IrOperation::SetOutput {
            origin: OperationId("op_5".into()),
            channel: ResolvedOutput {
                name: "Gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(false),
        };

        // Prove each variant holds concrete (resolved) data by extracting values
        assert!(matches!(home, IrOperation::Home { origin } if origin == OperationId("op_1".into())));
        assert!(matches!(move_to, IrOperation::MoveTo { origin, pose, profile }
            if origin == OperationId("op_2".into())
            && pose.position[0] == 1.0
            && profile.name == "default"));
        assert!(matches!(wait, IrOperation::Wait { origin, duration }
            if origin == OperationId("op_4".into())
            && duration == Duration::from_secs(1)));
        assert!(matches!(set_output, IrOperation::SetOutput { channel, .. }
            if channel.name == "Gripper"));
    }

    fn make_frame(name: &str, parent: &str) -> ResolvedFrame {
        ResolvedFrame {
            name: name.into(),
            parent: parent.into(),
            transform: IDENTITY_4X4,
        }
    }

    fn make_profile(name: &str, velocity: f64, acceleration: f64) -> ResolvedProfile {
        ResolvedProfile {
            name: name.into(),
            velocity,
            acceleration,
        }
    }

    #[test]
    fn ir_move_to_contains_pose() {
        let pose = ResolvedPose {
            position: [0.5, 0.0, 0.3],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: make_frame("base", "world"),
        };
        let op = IrOperation::MoveTo {
            origin: OperationId("op_10".into()),
            pose: pose.clone(),
            profile: make_profile("default", 1.0, 2.0),
        };
        match op {
            IrOperation::MoveTo { pose: p, .. } => {
                assert_eq!(p, pose);
                assert_eq!(p.position[0], 0.5);
                assert_eq!(p.orientation[3], 1.0);
            }
            _ => panic!("Expected IrOperation::MoveTo"),
        }
    }

    #[test]
    fn ir_follow_has_at_least_one_waypoint() {
        let op = IrOperation::Follow {
            origin: OperationId("op_11".into()),
            waypoints: vec![
                ResolvedPose {
                    position: [0.0, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: make_frame("base", "world"),
                },
            ],
            profile: make_profile("default", 1.0, 2.0),
        };
        match op {
            IrOperation::Follow { waypoints, .. } => {
                assert!(!waypoints.is_empty(), "IrFollow must have >= 1 waypoint");
                assert!(waypoints.len() >= 1);
            }
            _ => panic!("Expected IrOperation::Follow"),
        }
    }

    #[test]
    fn ir_follow_multiple_waypoints_preserves_order() {
        let wp_a = ResolvedPose {
            position: [0.0, 0.0, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: make_frame("base", "world"),
        };
        let wp_b = ResolvedPose {
            position: [1.0, 0.0, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: make_frame("base", "world"),
        };
        let op = IrOperation::Follow {
            origin: OperationId("op_12".into()),
            waypoints: vec![wp_a.clone(), wp_b.clone()],
            profile: make_profile("default", 1.0, 2.0),
        };
        match op {
            IrOperation::Follow { waypoints, .. } => {
                assert_eq!(waypoints.len(), 2);
                assert_eq!(waypoints[0].position[0], 0.0);
                assert_eq!(waypoints[1].position[0], 1.0);
            }
            _ => panic!("Expected IrOperation::Follow"),
        }
    }

    #[test]
    fn ir_home_retains_operation_id() {
        let op_id = OperationId("op_42".into());
        let op = IrOperation::Home {
            origin: op_id.clone(),
        };
        match op {
            IrOperation::Home { origin } => {
                assert_eq!(origin, op_id);
                assert_eq!(origin.as_str(), "op_42");
            }
            _ => panic!("Expected IrOperation::Home"),
        }
    }

    #[test]
    fn ir_all_variants_preserve_origin() {
        // Every IrOperation variant retains the originating OperationId for traceability.
        let cases: Vec<(IrOperation, &str)> = vec![
            (IrOperation::Home { origin: OperationId("op_1".into()) }, "op_1"),
            (IrOperation::MoveTo {
                origin: OperationId("op_2".into()),
                pose: ResolvedPose {
                    position: [0.0; 3],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: make_frame("base", "world"),
                },
                profile: make_profile("default", 1.0, 2.0),
            }, "op_2"),
            (IrOperation::Follow {
                origin: OperationId("op_3".into()),
                waypoints: vec![],
                profile: make_profile("default", 1.0, 2.0),
            }, "op_3"),
            (IrOperation::Wait {
                origin: OperationId("op_4".into()),
                duration: Duration::ZERO,
            }, "op_4"),
            (IrOperation::SetOutput {
                origin: OperationId("op_5".into()),
                channel: ResolvedOutput {
                    name: "Ch".into(),
                    channel_type: "digital".into(),
                },
                value: OutputValue::Bool(true),
            }, "op_5"),
        ];

        for (i, (op, expected)) in cases.iter().enumerate() {
            let origin_str = match op {
                IrOperation::Home { origin }
                | IrOperation::MoveTo { origin, .. }
                | IrOperation::Follow { origin, .. }
                | IrOperation::Wait { origin, .. }
                | IrOperation::SetOutput { origin, .. } => origin,
            };
            assert_eq!(
                origin_str.as_str(),
                *expected,
                "case {i}: expected origin {expected}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Clone + Debug (type hygiene)
    // -----------------------------------------------------------------------

    #[test]
    fn ir_program_is_clone_and_debug() {
        let a = sample_program();
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{a:?}");
    }

    #[test]
    fn ir_operation_is_clone_and_debug() {
        let a = IrOperation::Home {
            origin: OperationId("op_1".into()),
        };
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{a:?}");
    }
}
