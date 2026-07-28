//! SCARA lowering backend.
//!
//! Implements the deterministic mapping rules from `PlannedOperation` variants
//! to `MotionInstruction` for the SCARA robot arm.
//!
//! ## Lowering Rules
//!
//! | PlannedOperation | MotionInstruction(s) |
//! |---|---|
//! | `Home` | `MoveJ(home_pose)` |
//! | `MoveTo { strategy: Joint }` | `MoveJ(target)` |
//! | `MoveTo { strategy: Linear }` | `MoveL(target)` |
//! | `Follow(N waypoints)` | N × `MoveL` (first included, order preserved) |
//! | `Wait` | `Delay(duration)` |
//! | `SetOutput` | `SetOutput(channel, value)` |

use thalos_core::motion::{
    MotionInstruction, MotionMetadata, MotionPose, MotionProfile, MotionProgram, MotionTarget,
};

use crate::ir::types::ResolvedPose;
use crate::pipeline::{PlannedOperation, PlannedProgram};

use super::errors::LoweringError;
use super::traits::LoweringBackend;

/// SCARA lowering backend.
///
/// Stateless and purely mechanical: applies the 6 mapping rules without
/// heuristics or optimization.
pub struct ScaraLowering;

impl LoweringBackend for ScaraLowering {
    fn backend_name(&self) -> &'static str {
        "scara"
    }

    fn lower(&self, program: &PlannedProgram) -> Result<MotionProgram, LoweringError> {
        let mut instructions = Vec::new();

        for op in &program.operations {
            match op {
                PlannedOperation::Home { origin } => {
                    let home = program
                        .home_pose
                        .as_ref()
                        .ok_or_else(|| LoweringError::InvalidHomePose(
                            format!("Home operation {} requires a home pose, but PlannedProgram::home_pose is None", origin),
                        ))?;
                    instructions.push(MotionInstruction::MoveJ {
                        origin: origin.clone(),
                        target: MotionTarget::Pose(home.clone()),
                        profile: default_profile(),
                    });
                }
                PlannedOperation::MoveTo {
                    origin,
                    strategy,
                    pose,
                    profile,
                } => {
                    let target = MotionTarget::Pose(pose.clone());
                    let profile = convert_profile(profile);
                    match strategy {
                        crate::pipeline::MotionStrategy::Joint => {
                            instructions.push(MotionInstruction::MoveJ {
                                origin: origin.clone(),
                                target,
                                profile,
                            });
                        }
                        crate::pipeline::MotionStrategy::Linear => {
                            instructions.push(MotionInstruction::MoveL {
                                origin: origin.clone(),
                                target,
                                profile,
                            });
                        }
                    }
                }
                PlannedOperation::Follow {
                    origin,
                    waypoints,
                    profile,
                    ..
                } => {
                    let profile = convert_profile(profile);
                    for wp in waypoints {
                        let pose = resolved_pose_to_motion_pose(wp);
                        instructions.push(MotionInstruction::MoveL {
                            origin: origin.clone(),
                            target: MotionTarget::Pose(pose),
                            profile: profile.clone(),
                        });
                    }
                }
                PlannedOperation::Wait { origin, duration } => {
                    instructions.push(MotionInstruction::Delay {
                        origin: origin.clone(),
                        duration: *duration,
                    });
                }
                PlannedOperation::SetOutput {
                    origin,
                    channel,
                    value,
                } => {
                    instructions.push(MotionInstruction::SetOutput {
                        origin: origin.clone(),
                        channel: channel.clone(),
                        value: value.clone(),
                    });
                }
            }
        }

        Ok(MotionProgram {
            instructions,
            metadata: MotionMetadata {
                schema_version: 1,
                source_project: "thalos-compiler".into(),
            },
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Default motion profile used for Home operations (no source profile).
fn default_profile() -> MotionProfile {
    MotionProfile {
        max_velocity: 500.0,
        max_acceleration: 1000.0,
        max_jerk: None,
    }
}

/// Convert a `MotionProfile` from the planning IR to the core motion type.
fn convert_profile(profile: &MotionProfile) -> MotionProfile {
    profile.clone()
}

/// Convert a `ResolvedPose` (IR type with frame metadata) to `MotionPose`
/// (core type with frame name only).
fn resolved_pose_to_motion_pose(wp: &ResolvedPose) -> MotionPose {
    MotionPose {
        position: wp.position,
        orientation: wp.orientation,
        frame: wp.frame.name.clone(),
    }
}

// ---------------------------------------------------------------------------
// Tests  (Tasks 2.8–2.15)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::types::{ResolvedFrame, ResolvedPose, ResolvedProfile};
    use crate::pipeline::{MotionStrategy, PlanMetadata, Version};
    use std::time::Duration;
    use thalos_core::ids::OperationId;
    use thalos_core::motion::{
        MotionInstruction, MotionPose, MotionProfile, OutputChannel, OutputValue,
    };

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fn dummy_home_pose() -> MotionPose {
        MotionPose {
            position: [0.0, 0.0, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        }
    }

    fn dummy_metadata() -> PlanMetadata {
        PlanMetadata {
            pipeline_version: Version { major: 0, minor: 1 },
            execution_time: Duration::ZERO,
            compilation_options: crate::pipeline::CompilationOptions {
                policy_mode: crate::pipeline::PolicyMode::Strict,
            },
            diagnostics: vec![],
            stage_status: vec![],
        }
    }

    fn dummy_profile() -> MotionProfile {
        MotionProfile {
            max_velocity: 1.0,
            max_acceleration: 2.0,
            max_jerk: None,
        }
    }

    fn dummy_resolved_profile() -> ResolvedProfile {
        ResolvedProfile {
            name: "default".into(),
            velocity: 1.0,
            acceleration: 2.0,
        }
    }

    fn dummy_frame() -> ResolvedFrame {
        ResolvedFrame {
            name: "world".into(),
            parent: "".into(),
            transform: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    fn dummy_pose() -> MotionPose {
        MotionPose {
            position: [1.0, 2.0, 3.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        }
    }

    fn dummy_resolved_pose() -> ResolvedPose {
        ResolvedPose {
            position: [1.0, 2.0, 3.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: dummy_frame(),
        }
    }

    fn make_program(ops: Vec<PlannedOperation>, home_pose: Option<MotionPose>) -> PlannedProgram {
        PlannedProgram {
            operations: ops,
            home_pose,
            constraints: crate::pipeline::ConstraintSet { items: vec![] },
            metadata: dummy_metadata(),
        }
    }

    fn lower_once(ops: Vec<PlannedOperation>, home_pose: Option<MotionPose>) -> MotionProgram {
        let program = make_program(ops, home_pose);
        let backend = ScaraLowering;
        backend.lower(&program).expect("lowering should succeed")
    }

    // ------------------------------------------------------------------
    // 2.8 — Table-driven: each PlannedOperation variant → correct instruction type
    // ------------------------------------------------------------------

    #[test]
    fn home_lowers_to_move_j() {
        let ops = vec![PlannedOperation::Home {
            origin: OperationId("op_01".into()),
        }];
        let program = make_program(ops, Some(dummy_home_pose()));
        let backend = ScaraLowering;
        let result = backend.lower(&program).expect("lower should succeed");

        assert_eq!(result.instructions.len(), 1);
        assert!(
            matches!(
                &result.instructions[0],
                MotionInstruction::MoveJ {
                    target: MotionTarget::Pose(p),
                    ..
                } if p == &dummy_home_pose()
            ),
            "Home should lower to MoveJ with home_pose"
        );
    }

    #[test]
    fn move_to_joint_lowers_to_move_j() {
        let ops = vec![PlannedOperation::MoveTo {
            origin: OperationId("op_02".into()),
            strategy: MotionStrategy::Joint,
            pose: dummy_pose(),
            profile: dummy_profile(),
        }];
        let program = make_program(ops, Some(dummy_home_pose()));
        let backend = ScaraLowering;
        let result = backend.lower(&program).expect("lower should succeed");

        assert_eq!(result.instructions.len(), 1);
        assert!(
            matches!(&result.instructions[0], MotionInstruction::MoveJ { .. }),
            "MoveTo(Joint) should lower to MoveJ"
        );
    }

    #[test]
    fn move_to_linear_lowers_to_move_l() {
        let ops = vec![PlannedOperation::MoveTo {
            origin: OperationId("op_03".into()),
            strategy: MotionStrategy::Linear,
            pose: dummy_pose(),
            profile: dummy_profile(),
        }];
        let program = make_program(ops, Some(dummy_home_pose()));
        let backend = ScaraLowering;
        let result = backend.lower(&program).expect("lower should succeed");

        assert_eq!(result.instructions.len(), 1);
        assert!(
            matches!(&result.instructions[0], MotionInstruction::MoveL { .. }),
            "MoveTo(Linear) should lower to MoveL"
        );
    }

    #[test]
    fn wait_lowers_to_delay() {
        let ops = vec![PlannedOperation::Wait {
            origin: OperationId("op_04".into()),
            duration: Duration::from_millis(2500),
        }];
        let program = make_program(ops, Some(dummy_home_pose()));
        let backend = ScaraLowering;
        let result = backend.lower(&program).expect("lower should succeed");

        assert_eq!(result.instructions.len(), 1);
        match &result.instructions[0] {
            MotionInstruction::Delay { origin, duration } => {
                assert_eq!(origin, &OperationId("op_04".into()));
                assert_eq!(*duration, Duration::from_millis(2500));
            }
            _ => panic!("Wait should lower to Delay"),
        }
    }

    #[test]
    fn set_output_lowers_to_set_output() {
        let ops = vec![PlannedOperation::SetOutput {
            origin: OperationId("op_05".into()),
            channel: OutputChannel {
                name: "gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        }];
        let program = make_program(ops, Some(dummy_home_pose()));
        let backend = ScaraLowering;
        let result = backend.lower(&program).expect("lower should succeed");

        assert_eq!(result.instructions.len(), 1);
        match &result.instructions[0] {
            MotionInstruction::SetOutput {
                origin,
                channel,
                value,
            } => {
                assert_eq!(origin, &OperationId("op_05".into()));
                assert_eq!(channel.name, "gripper");
                assert_eq!(*value, OutputValue::Bool(true));
            }
            _ => panic!("SetOutput should lower to SetOutput"),
        }
    }

    // ------------------------------------------------------------------
    // 2.9 — Follow cardinality: N waypoints → N MoveL
    // ------------------------------------------------------------------

    #[test]
    fn follow_one_waypoint_emits_one_move_l() {
        let ops = vec![PlannedOperation::Follow {
            origin: OperationId("op_06".into()),
            strategy: MotionStrategy::Linear,
            waypoints: vec![dummy_resolved_pose()],
            profile: dummy_profile(),
        }];
        let result = lower_once(ops, Some(dummy_home_pose()));

        assert_eq!(result.instructions.len(), 1);
        assert!(
            matches!(&result.instructions[0], MotionInstruction::MoveL { .. }),
            "Follow(1) should emit 1 MoveL"
        );
    }

    #[test]
    fn follow_three_waypoints_emits_three_move_l() {
        let wp = dummy_resolved_pose();
        let ops = vec![PlannedOperation::Follow {
            origin: OperationId("op_07".into()),
            strategy: MotionStrategy::Linear,
            waypoints: vec![wp.clone(), wp.clone(), wp.clone()],
            profile: dummy_profile(),
        }];
        let result = lower_once(ops, Some(dummy_home_pose()));

        assert_eq!(result.instructions.len(), 3);
        for (i, instr) in result.instructions.iter().enumerate() {
            assert!(
                matches!(instr, MotionInstruction::MoveL { .. }),
                "Follow instruction {i} should be MoveL"
            );
        }
    }

    #[test]
    fn follow_five_waypoints_emits_five_move_l() {
        let wp = dummy_resolved_pose();
        let ops = vec![PlannedOperation::Follow {
            origin: OperationId("op_08".into()),
            strategy: MotionStrategy::Linear,
            waypoints: vec![wp.clone(), wp.clone(), wp.clone(), wp.clone(), wp.clone()],
            profile: dummy_profile(),
        }];
        let result = lower_once(ops, Some(dummy_home_pose()));

        assert_eq!(result.instructions.len(), 5);
        for (i, instr) in result.instructions.iter().enumerate() {
            assert!(
                matches!(instr, MotionInstruction::MoveL { .. }),
                "Follow instruction {i} should be MoveL"
            );
        }
    }

    // ------------------------------------------------------------------
    // 2.10 — Origin preserved on every emitted instruction
    // ------------------------------------------------------------------

    #[test]
    fn all_instructions_carry_origin() {
        let ops = vec![
            PlannedOperation::Home {
                origin: OperationId("op_01".into()),
            },
            PlannedOperation::MoveTo {
                origin: OperationId("op_02".into()),
                strategy: MotionStrategy::Joint,
                pose: dummy_pose(),
                profile: dummy_profile(),
            },
            PlannedOperation::Follow {
                origin: OperationId("op_03".into()),
                strategy: MotionStrategy::Linear,
                waypoints: vec![dummy_resolved_pose(), dummy_resolved_pose()],
                profile: dummy_profile(),
            },
            PlannedOperation::Wait {
                origin: OperationId("op_04".into()),
                duration: Duration::ZERO,
            },
            PlannedOperation::SetOutput {
                origin: OperationId("op_05".into()),
                channel: OutputChannel {
                    name: "light".into(),
                    channel_type: "digital".into(),
                },
                value: OutputValue::Bool(false),
            },
        ];
        let program = make_program(ops, Some(dummy_home_pose()));
        let backend = ScaraLowering;
        let result = backend.lower(&program).expect("lower should succeed");

        // Total: Home(1) + MoveTo(1) + Follow(2) + Wait(1) + SetOutput(1) = 6
        assert_eq!(result.instructions.len(), 6);

        // Home
        assert_origin(&result.instructions[0], "op_01");
        // MoveTo(Joint)
        assert_origin(&result.instructions[1], "op_02");
        // Follow(2 waypoints)
        assert_origin(&result.instructions[2], "op_03");
        assert_origin(&result.instructions[3], "op_03");
        // Wait
        assert_origin(&result.instructions[4], "op_04");
        // SetOutput
        assert_origin(&result.instructions[5], "op_05");
    }

    fn assert_origin(instr: &MotionInstruction, expected: &str) {
        let origin = match instr {
            MotionInstruction::MoveJ { origin, .. }
            | MotionInstruction::MoveL { origin, .. }
            | MotionInstruction::Delay { origin, .. }
            | MotionInstruction::SetOutput { origin, .. } => origin,
        };
        assert_eq!(
            origin.as_str(),
            expected,
            "expected origin '{expected}', got '{}'",
            origin.as_str()
        );
    }

    // ------------------------------------------------------------------
    // 2.11 — Determinism: same input → equal output on repeat
    // ------------------------------------------------------------------

    #[test]
    fn determinism_same_input_equal_output() {
        let ops = vec![
            PlannedOperation::Home {
                origin: OperationId("op_01".into()),
            },
            PlannedOperation::MoveTo {
                origin: OperationId("op_02".into()),
                strategy: MotionStrategy::Joint,
                pose: dummy_pose(),
                profile: dummy_profile(),
            },
            PlannedOperation::Wait {
                origin: OperationId("op_03".into()),
                duration: Duration::from_secs(1),
            },
        ];
        let program = make_program(ops, Some(dummy_home_pose()));
        let backend = ScaraLowering;

        let result_a = backend.lower(&program).expect("first call");
        let result_b = backend.lower(&program).expect("second call");

        assert_eq!(
            result_a, result_b,
            "lower() must produce equal MotionProgram for the same input"
        );
    }

    // ------------------------------------------------------------------
    // 2.12 — InvalidHomePose when home_pose is None
    // ------------------------------------------------------------------

    #[test]
    fn home_without_home_pose_returns_invalid_home_pose() {
        let ops = vec![PlannedOperation::Home {
            origin: OperationId("op_01".into()),
        }];
        let program = make_program(ops, None); // no home_pose
        let backend = ScaraLowering;

        let result = backend.lower(&program);

        match result {
            Err(LoweringError::InvalidHomePose(msg)) => {
                assert!(!msg.is_empty(), "error message should not be empty");
                assert!(
                    msg.contains("op_01"),
                    "error should mention the operation ID"
                );
            }
            other => panic!("Expected InvalidHomePose, got: {other:?}"),
        }
    }

    // ------------------------------------------------------------------
    // 2.13 — Empty PlannedProgram → empty MotionProgram (no error)
    // ------------------------------------------------------------------

    #[test]
    fn empty_planned_program_yields_empty_motion_program() {
        let ops = vec![];
        let program = make_program(ops, None);
        let backend = ScaraLowering;

        let result = backend
            .lower(&program)
            .expect("empty program should not error");

        assert!(
            result.instructions.is_empty(),
            "empty PlannedProgram should produce 0 instructions"
        );
        assert_eq!(result.metadata.schema_version, 1);
        assert_eq!(result.metadata.source_project, "thalos-compiler");
    }

    // ------------------------------------------------------------------
    // 2.14 — Instruction order preserved across mixed operations
    // ------------------------------------------------------------------

    #[test]
    fn mixed_operations_preserve_order() {
        let ops = vec![
            PlannedOperation::MoveTo {
                origin: OperationId("op_01".into()),
                strategy: MotionStrategy::Joint,
                pose: dummy_pose(),
                profile: dummy_profile(),
            },
            PlannedOperation::Wait {
                origin: OperationId("op_02".into()),
                duration: Duration::from_secs(1),
            },
            PlannedOperation::SetOutput {
                origin: OperationId("op_03".into()),
                channel: OutputChannel {
                    name: "valve".into(),
                    channel_type: "digital".into(),
                },
                value: OutputValue::Integer(1),
            },
            PlannedOperation::MoveTo {
                origin: OperationId("op_04".into()),
                strategy: MotionStrategy::Linear,
                pose: dummy_pose(),
                profile: dummy_profile(),
            },
        ];
        let result = lower_once(ops, Some(dummy_home_pose()));

        assert_eq!(result.instructions.len(), 4);
        assert!(
            matches!(&result.instructions[0], MotionInstruction::MoveJ { .. }),
            "instruction 0 should be MoveJ"
        );
        assert!(
            matches!(&result.instructions[1], MotionInstruction::Delay { .. }),
            "instruction 1 should be Delay"
        );
        assert!(
            matches!(&result.instructions[2], MotionInstruction::SetOutput { .. }),
            "instruction 2 should be SetOutput"
        );
        assert!(
            matches!(&result.instructions[3], MotionInstruction::MoveL { .. }),
            "instruction 3 should be MoveL"
        );
    }

    // ------------------------------------------------------------------
    // 2.15 — Integration: full IrProgram → pipeline → lowering → MotionProgram
    // ------------------------------------------------------------------

    #[test]
    fn full_pipeline_lowering_produces_valid_motion_program() {
        use crate::ir::{IrOperation, IrProgram};
        use crate::pipeline::policy::StrictPolicy;
        use crate::pipeline::{CompilationOptions, PolicyMode, run_pipeline};
        use thalos_document::id::OperationId;
        use thalos_document::operation::io::OutputValue as DocOutputValue;
        use thalos_document::project::Metadata as ProjectMetadata;

        // Build IrProgram with all 5 operation variants
        let ir = IrProgram {
            version: 1,
            operations: vec![
                IrOperation::Home {
                    origin: OperationId("op_01".into()),
                },
                IrOperation::MoveTo {
                    origin: OperationId("op_02".into()),
                    pose: dummy_resolved_pose(),
                    profile: dummy_resolved_profile(),
                },
                IrOperation::Follow {
                    origin: OperationId("op_03".into()),
                    waypoints: vec![
                        dummy_resolved_pose(),
                        dummy_resolved_pose(),
                        dummy_resolved_pose(),
                    ],
                    profile: dummy_resolved_profile(),
                },
                IrOperation::Wait {
                    origin: OperationId("op_04".into()),
                    duration: Duration::from_millis(500),
                },
                IrOperation::SetOutput {
                    origin: OperationId("op_05".into()),
                    channel: crate::ir::types::ResolvedOutput {
                        name: "gripper".into(),
                        channel_type: "digital".into(),
                    },
                    value: DocOutputValue::Bool(true),
                },
            ],
            source_metadata: ProjectMetadata {
                name: "integration_test".into(),
                version: 1,
                created_at: "".into(),
                modified_at: "".into(),
            },
        };

        // Run pipeline with strict policy
        let options = CompilationOptions {
            policy_mode: PolicyMode::Strict,
        };
        let policy = StrictPolicy;
        let mut planned = run_pipeline(ir, &policy, options).expect("pipeline should succeed");
        planned.home_pose = Some(dummy_home_pose());

        // Lower to MotionProgram
        let backend = ScaraLowering;
        let motion = backend.lower(&planned).expect("lowering should succeed");

        // Verify — 5 operations → Home(1) + MoveTo(1) + Follow(3) + Wait(1) + SetOutput(1) = 7
        assert_eq!(
            motion.instructions.len(),
            7,
            "expected 7 instructions from 5 operations"
        );

        // Check type order: MoveJ(Home), MoveJ(MoveTo/Joint), MoveL*3(Follow), Delay(Wait), SetOutput
        assert!(
            matches!(&motion.instructions[0], MotionInstruction::MoveJ { .. }),
            "instruction[0]: expected MoveJ (Home)"
        );
        assert!(
            matches!(&motion.instructions[1], MotionInstruction::MoveJ { .. }),
            "instruction[1]: expected MoveJ (MoveTo/Joint)"
        );
        assert!(
            matches!(&motion.instructions[2], MotionInstruction::MoveL { .. }),
            "instruction[2]: expected MoveL (Follow wp0)"
        );
        assert!(
            matches!(&motion.instructions[3], MotionInstruction::MoveL { .. }),
            "instruction[3]: expected MoveL (Follow wp1)"
        );
        assert!(
            matches!(&motion.instructions[4], MotionInstruction::MoveL { .. }),
            "instruction[4]: expected MoveL (Follow wp2)"
        );
        assert!(
            matches!(&motion.instructions[5], MotionInstruction::Delay { .. }),
            "instruction[5]: expected Delay (Wait)"
        );
        assert!(
            matches!(&motion.instructions[6], MotionInstruction::SetOutput { .. }),
            "instruction[6]: expected SetOutput"
        );

        // Verify origins using assert_origin helper
        assert_origin(&motion.instructions[0], "op_01");
        assert_origin(&motion.instructions[1], "op_02");
        assert_origin(&motion.instructions[2], "op_03");
        assert_origin(&motion.instructions[3], "op_03");
        assert_origin(&motion.instructions[4], "op_03");
        assert_origin(&motion.instructions[5], "op_04");
        assert_origin(&motion.instructions[6], "op_05");
    }
}
