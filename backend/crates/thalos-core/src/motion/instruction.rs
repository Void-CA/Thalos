use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::ids::OperationId;

use super::target::{MotionProfile, MotionTarget, OutputChannel, OutputValue};

/// A single motion instruction in a `MotionProgram`.
///
/// Exactly four variants exist in v1:
/// - `MoveJ`: joint-space movement to a target
/// - `MoveL`: linear (Cartesian) movement to a target
/// - `Delay`: wait for a duration
/// - `SetOutput`: set a digital/analog output channel
///
/// All variants carry an `origin: OperationId` linking back to the source IR
/// operation for traceability across the compiler → runtime pipeline.
///
/// Serialized as an internally-tagged enum (`"type": "move_j"`, etc.) for
/// consistent JSON interchange across all consumers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MotionInstruction {
    MoveJ {
        origin: OperationId,
        target: MotionTarget,
        profile: MotionProfile,
    },
    MoveL {
        origin: OperationId,
        target: MotionTarget,
        profile: MotionProfile,
    },
    Delay {
        origin: OperationId,
        duration: Duration,
    },
    SetOutput {
        origin: OperationId,
        channel: OutputChannel,
        value: OutputValue,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::motion::target::*;

    // ── Task 2.1: Construction of all 4 variants ────────────────────────

    #[test]
    fn move_j_constructs_with_origin_and_fields() {
        let origin = OperationId("1".to_string());
        let target = MotionTarget::Pose(MotionPose {
            position: [1.0, 2.0, 3.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        });
        let profile = MotionProfile {
            max_velocity: 500.0,
            max_acceleration: 1000.0,
            max_jerk: None,
        };

        let instr = MotionInstruction::MoveJ {
            origin,
            target: target.clone(),
            profile: profile.clone(),
        };

        match &instr {
            MotionInstruction::MoveJ {
                origin: o,
                target: t,
                profile: p,
            } => {
                assert_eq!(o, &OperationId("1".to_string()));
                assert_eq!(*t, target);
                assert_eq!(*p, profile);
            }
            _ => panic!("Expected MoveJ variant"),
        }
    }

    #[test]
    fn move_l_constructs_with_origin_and_fields() {
        let origin = OperationId("2".to_string());
        let target = MotionTarget::Pose(MotionPose {
            position: [4.0, 5.0, 6.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "tool0".into(),
        });
        let profile = MotionProfile {
            max_velocity: 250.0,
            max_acceleration: 500.0,
            max_jerk: Some(750.0),
        };

        let instr = MotionInstruction::MoveL {
            origin,
            target: target.clone(),
            profile: profile.clone(),
        };

        match &instr {
            MotionInstruction::MoveL {
                origin: o,
                target: t,
                profile: p,
            } => {
                assert_eq!(o, &OperationId("2".to_string()));
                assert_eq!(*t, target);
                assert_eq!(*p, profile);
            }
            _ => panic!("Expected MoveL variant"),
        }
    }

    #[test]
    fn delay_constructs_with_origin_and_duration() {
        let origin = OperationId("3".to_string());
        let duration = Duration::from_millis(1500);

        let instr = MotionInstruction::Delay { origin, duration };

        match &instr {
            MotionInstruction::Delay {
                origin: o,
                duration: d,
            } => {
                assert_eq!(o, &OperationId("3".to_string()));
                assert_eq!(*d, Duration::from_millis(1500));
            }
            _ => panic!("Expected Delay variant"),
        }
    }

    #[test]
    fn set_output_constructs_with_origin_channel_value() {
        let origin = OperationId("4".to_string());
        let channel = OutputChannel {
            name: "gripper".into(),
            channel_type: "digital".into(),
        };
        let value = OutputValue::Bool(true);

        let instr = MotionInstruction::SetOutput {
            origin,
            channel: channel.clone(),
            value: value.clone(),
        };

        match &instr {
            MotionInstruction::SetOutput {
                origin: o,
                channel: c,
                value: v,
            } => {
                assert_eq!(o, &OperationId("4".to_string()));
                assert_eq!(*c, channel);
                assert_eq!(*v, value);
            }
            _ => panic!("Expected SetOutput variant"),
        }
    }

    // ── Task 2.4: Serde round-trip, forward compat, type tags, Clone+Eq ─

    #[test]
    fn all_variants_serde_round_trip() {
        let instructions = vec![
            MotionInstruction::MoveJ {
                origin: OperationId("1".to_string()),
                target: MotionTarget::Pose(MotionPose {
                    position: [1.0, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: "world".into(),
                }),
                profile: MotionProfile {
                    max_velocity: 100.0,
                    max_acceleration: 200.0,
                    max_jerk: None,
                },
            },
            MotionInstruction::MoveL {
                origin: OperationId("2".to_string()),
                target: MotionTarget::Pose(MotionPose {
                    position: [2.0, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: "base".into(),
                }),
                profile: MotionProfile {
                    max_velocity: 300.0,
                    max_acceleration: 600.0,
                    max_jerk: Some(900.0),
                },
            },
            MotionInstruction::Delay {
                origin: OperationId("3".to_string()),
                duration: Duration::from_secs(5),
            },
            MotionInstruction::SetOutput {
                origin: OperationId("4".to_string()),
                channel: OutputChannel {
                    name: "vacuum".into(),
                    channel_type: "analog".into(),
                },
                value: OutputValue::Integer(42),
            },
        ];

        for instr in &instructions {
            let json = serde_json::to_string(instr).expect("serialize");
            let decoded: MotionInstruction = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(*instr, decoded, "round-trip failed for {instr:?}");
        }
    }

    #[test]
    fn serde_internally_tagged_type_tags() {
        let move_j = MotionInstruction::MoveJ {
            origin: OperationId("1".to_string()),
            target: MotionTarget::Pose(MotionPose {
                position: [0.0, 0.0, 0.0],
                orientation: [0.0, 0.0, 0.0, 1.0],
                frame: "world".into(),
            }),
            profile: MotionProfile {
                max_velocity: 100.0,
                max_acceleration: 200.0,
                max_jerk: None,
            },
        };
        let json = serde_json::to_string(&move_j).expect("serialize");
        assert!(
            json.contains(r#""type":"move_j""#),
            "Expected type tag 'move_j', got: {json}"
        );

        let delay = MotionInstruction::Delay {
            origin: OperationId("2".to_string()),
            duration: Duration::from_secs(3),
        };
        let json = serde_json::to_string(&delay).expect("serialize");
        assert!(
            json.contains(r#""type":"delay""#),
            "Expected type tag 'delay', got: {json}"
        );

        let set_output = MotionInstruction::SetOutput {
            origin: OperationId("3".to_string()),
            channel: OutputChannel {
                name: "gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        };
        let json = serde_json::to_string(&set_output).expect("serialize");
        assert!(
            json.contains(r#""type":"set_output""#),
            "Expected type tag 'set_output', got: {json}"
        );
    }

    #[test]
    fn serde_forward_compat_unknown_field() {
        let json = r#"{
            "type":"move_j",
            "origin":"1",
            "target":{"type":"pose","position":[0.0,0.0,0.0],"orientation":[0.0,0.0,0.0,1.0],"frame":"world"},
            "profile":{"max_velocity":100.0,"max_acceleration":200.0,"max_jerk":null},
            "unknown_field":"should_be_ignored"
        }"#;
        let result: Result<MotionInstruction, _> = serde_json::from_str(json);
        assert!(
            result.is_ok(),
            "Should tolerate unknown fields for forward compatibility"
        );
    }

    #[test]
    fn clone_and_eq_after_round_trip() {
        let original = MotionInstruction::MoveJ {
            origin: OperationId("42".to_string()),
            target: MotionTarget::Pose(MotionPose {
                position: [1.0, 2.0, 3.0],
                orientation: [0.0, 0.0, 0.0, 1.0],
                frame: "world".into(),
            }),
            profile: MotionProfile {
                max_velocity: 100.0,
                max_acceleration: 200.0,
                max_jerk: None,
            },
        };

        // Clone
        let cloned = original.clone();
        assert_eq!(original, cloned, "Clone should produce equal value");

        // Round-trip
        let json = serde_json::to_string(&original).expect("serialize");
        let decoded: MotionInstruction = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, decoded, "Round-trip should preserve equality");

        // Clone after round-trip
        let decoded_clone = decoded.clone();
        assert_eq!(
            decoded, decoded_clone,
            "Clone after round-trip should preserve equality"
        );
    }
}
