use std::time::Duration;

use thalos_core::{
    execution::{
        program::{ExecutionInstruction, ExecutionProgram},
        runtime::{RuntimeAction, RuntimeEvent, RuntimeProgram},
    },
    kinematics::inverse::{IKGoal, IKSolver, IKStatus},
    motion::segment::MotionSegment,
    motion::target::{MotionPose, MotionTarget},
    spatial::{
        frame::{FrameId, FrameRegistry},
        pose::Pose,
    },
};
use thalos_math::{Quaternion, Transform3D, UnitQuaternion, Vector3};

use super::types::{MotionResolution, ResolutionError};
use crate::motion::program::PlanningProgram;

/// Resolves an `ExecutionProgram` into separate planning and runtime streams.
///
/// - `MoveJ` and `MoveL` instructions → `PlanningProgram` segments
///   (requires IK for joint-space resolution of `MoveJ`).
/// - `Delay` and `SetOutput` instructions → `RuntimeProgram` events
///
/// # Invariants
///
/// - **Order preservation**: Instructions are processed sequentially; output
///   order matches input order.
/// - **Origin preservation (I2)**: Each segment/event copies the `origin`
///   `OperationId` from its source instruction; no transformation drops or
///   renames an identity.
/// - **Determinism**: No I/O, no side effects, no global state.
/// - **Atomic fail**: On any error, no partial `MotionResolution` is returned.
pub struct MotionResolver<'a> {
    ik_solver: &'a dyn IKSolver,
    frame_registry: &'a FrameRegistry,
    initial_state: &'a [f64],
}

impl<'a> MotionResolver<'a> {
    /// Create a new resolver for a given IK solver, frame registry, and
    /// initial robot joint state.
    ///
    /// The `initial_state` seeds the IK solver on the first `MoveJ`
    /// instruction and is tracked internally through all subsequent moves.
    ///
    /// # Design note
    ///
    /// The `initial_state` parameter extends the design from `design.md`
    /// — the original interface did not include it, but IK requires a `q0`
    /// seed. Without it, `MoveJ` resolution cannot determine the robot's
    /// starting configuration.
    pub fn new(
        ik_solver: &'a dyn IKSolver,
        frame_registry: &'a FrameRegistry,
        initial_state: &'a [f64],
    ) -> Self {
        Self {
            ik_solver,
            frame_registry,
            initial_state,
        }
    }

    /// Resolve an `ExecutionProgram` into `MotionResolution`.
    ///
    /// Processes instructions in order. Each instruction maps to exactly one
    /// output element in either the planning or runtime stream (invariant:
    /// completeness). On failure, no partial result is returned.
    pub fn resolve(&self, program: &ExecutionProgram) -> Result<MotionResolution, ResolutionError> {
        let mut planning_segments: Vec<MotionSegment> = Vec::new();
        let mut runtime_events: Vec<RuntimeEvent> = Vec::new();
        let mut current_joints = self.initial_state.to_vec();

        for (index, instruction) in program.instructions.iter().enumerate() {
            match instruction {
                ExecutionInstruction::MoveJ {
                    origin,
                    target,
                    profile,
                } => {
                    let pose = motion_target_to_pose(target, self.frame_registry)?;
                    let ik_result = self
                        .ik_solver
                        .solve(&current_joints, IKGoal::Position(pose.translation()));

                    match ik_result.status {
                        IKStatus::Converged => {
                            planning_segments.push(MotionSegment::MoveJ {
                                origin: origin.clone(),
                                target: ik_result.q.clone(),
                                max_velocity: Some(profile.max_velocity),
                                max_acceleration: Some(profile.max_acceleration),
                            });
                            current_joints = ik_result.q;
                        }
                        IKStatus::MaxIterations => {
                            return Err(ResolutionError::IkFailed {
                                instruction_index: index,
                                reason: format!("{:?}", ik_result.status),
                            });
                        }
                    }
                }

                ExecutionInstruction::MoveL {
                    origin,
                    target,
                    profile,
                } => {
                    let frame = resolve_frame(target, self.frame_registry)?;
                    let pose = motion_target_to_pose(target, self.frame_registry)?;
                    planning_segments.push(MotionSegment::MoveL {
                        origin: origin.clone(),
                        frame,
                        target_pose: pose,
                        max_velocity: Some(profile.max_velocity),
                    });
                }

                ExecutionInstruction::Delay { origin, duration } => {
                    runtime_events.push(RuntimeEvent {
                        operation_id: origin.clone(),
                        action: RuntimeAction::Delay(*duration),
                    });
                }

                ExecutionInstruction::SetOutput {
                    origin,
                    channel,
                    value,
                } => {
                    runtime_events.push(RuntimeEvent {
                        operation_id: origin.clone(),
                        action: RuntimeAction::SetOutput {
                            channel: channel.clone(),
                            value: value.clone(),
                        },
                    });
                }
            }
        }

        Ok(MotionResolution {
            planning: PlanningProgram::new(planning_segments),
            runtime: RuntimeProgram {
                events: runtime_events,
            },
        })
    }
}

// ─── Helper functions ───────────────────────────────────────────────────────

/// Convert a `MotionTarget` to a `Pose`, resolving the frame string via
/// `FrameRegistry`.
fn motion_target_to_pose(
    target: &MotionTarget,
    frame_registry: &FrameRegistry,
) -> Result<Pose, ResolutionError> {
    match target {
        MotionTarget::Pose(mp) => {
            let translation = Vector3::new(mp.position[0], mp.position[1], mp.position[2]);
            let quat = Quaternion::new(
                mp.orientation[0],
                mp.orientation[1],
                mp.orientation[2],
                mp.orientation[3],
            );
            let rotation =
                UnitQuaternion::new(quat).map_err(|_| ResolutionError::UnknownFrame("".into()))?;
            // Map error — quaternion normalisation can fail for zero norm
            let transform = Transform3D::from_translation_rotation(translation, rotation);
            let target_frame = resolve_frame_by_name(&mp.frame, frame_registry)?;
            Ok(Pose::new(FrameId::World, target_frame, transform))
        }
    }
}

/// Resolve the `frame` field from a `MotionTarget` to a `FrameId`.
fn resolve_frame(
    target: &MotionTarget,
    frame_registry: &FrameRegistry,
) -> Result<FrameId, ResolutionError> {
    match target {
        MotionTarget::Pose(mp) => resolve_frame_by_name(&mp.frame, frame_registry),
    }
}

fn resolve_frame_by_name(name: &str, registry: &FrameRegistry) -> Result<FrameId, ResolutionError> {
    registry
        .resolve_by_name(name)
        .ok_or_else(|| ResolutionError::UnknownFrame(name.to_string()))
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use thalos_core::{
        execution::program::ExecutionMetadata,
        ids::OperationId,
        kinematics::inverse::{IKResult, IKSolver},
        motion::target::{MotionPose, MotionProfile, OutputChannel, OutputValue},
    };

    // ── Mock IK solver ───────────────────────────────────────────────────

    struct NoopIKSolver;

    impl IKSolver for NoopIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> IKResult {
            IKResult::converged(q0.to_vec(), 1, 0.0, None)
        }
    }

    /// IK solver that always fails to converge.
    struct FailingIKSolver;

    impl IKSolver for FailingIKSolver {
        fn solve(&self, q0: &[f64], _goal: IKGoal) -> IKResult {
            IKResult::max_iterations(q0.to_vec(), 1000, 999.0, None)
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    fn make_registry() -> FrameRegistry {
        let mut reg = FrameRegistry::new();
        reg.create("world");
        reg
    }

    fn make_resolver<'a>(
        ik: &'a dyn IKSolver,
        registry: &'a FrameRegistry,
        initial_state: &'a [f64],
    ) -> MotionResolver<'a> {
        MotionResolver::new(ik, registry, initial_state)
    }

    fn sample_pose() -> MotionPose {
        MotionPose {
            position: [0.1, 0.2, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        }
    }

    fn sample_metadata() -> ExecutionMetadata {
        ExecutionMetadata {
            schema_version: 1,
            source_project: "test".into(),
        }
    }

    fn default_profile() -> MotionProfile {
        MotionProfile {
            max_velocity: 500.0,
            max_acceleration: 1000.0,
            max_jerk: None,
        }
    }

    // ── Test: empty program ───────────────────────────────────────────────

    #[test]
    fn empty_program_produces_empty_resolution() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![],
            metadata: sample_metadata(),
        };

        let result = resolver
            .resolve(&program)
            .expect("empty program should resolve");
        assert!(result.planning.segments.is_empty());
        assert!(result.runtime.events.is_empty());
    }

    // ── Test: motion-only (MoveJ, MoveL) ─────────────────────────────────

    #[test]
    fn motion_only_produces_planning_segments() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![
                ExecutionInstruction::MoveJ {
                    origin: OperationId("1".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
                ExecutionInstruction::MoveL {
                    origin: OperationId("2".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
            ],
            metadata: sample_metadata(),
        };

        let result = resolver
            .resolve(&program)
            .expect("motion-only should resolve");
        assert_eq!(result.planning.segments.len(), 2);
        assert!(result.runtime.events.is_empty());
        assert!(matches!(
            result.planning.segments[0],
            MotionSegment::MoveJ { .. }
        ));
        assert!(matches!(
            result.planning.segments[1],
            MotionSegment::MoveL { .. }
        ));
    }

    // ── Test: runtime-only (Delay, SetOutput) ─────────────────────────────

    #[test]
    fn runtime_only_produces_runtime_events() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![
                ExecutionInstruction::Delay {
                    origin: OperationId("1".to_string()),
                    duration: Duration::from_secs(2),
                },
                ExecutionInstruction::SetOutput {
                    origin: OperationId("2".to_string()),
                    channel: OutputChannel {
                        name: "gripper".into(),
                        channel_type: "digital".into(),
                    },
                    value: OutputValue::Bool(true),
                },
            ],
            metadata: sample_metadata(),
        };

        let result = resolver
            .resolve(&program)
            .expect("runtime-only should resolve");
        assert!(result.planning.segments.is_empty());
        assert_eq!(result.runtime.events.len(), 2);
        assert!(matches!(
            result.runtime.events[0].action,
            RuntimeAction::Delay(_)
        ));
        assert!(matches!(
            result.runtime.events[1].action,
            RuntimeAction::SetOutput { .. }
        ));
    }

    // ── Test: mixed program ───────────────────────────────────────────────

    #[test]
    fn mixed_program_has_correct_counts() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![
                ExecutionInstruction::MoveJ {
                    origin: OperationId("1".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
                ExecutionInstruction::Delay {
                    origin: OperationId("2".to_string()),
                    duration: Duration::from_secs(1),
                },
                ExecutionInstruction::MoveL {
                    origin: OperationId("3".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
                ExecutionInstruction::SetOutput {
                    origin: OperationId("4".to_string()),
                    channel: OutputChannel {
                        name: "gripper".into(),
                        channel_type: "digital".into(),
                    },
                    value: OutputValue::Bool(true),
                },
            ],
            metadata: sample_metadata(),
        };

        let result = resolver.resolve(&program).expect("mixed should resolve");
        assert_eq!(result.planning.segments.len(), 2);
        assert_eq!(result.runtime.events.len(), 2);
    }

    // ── Test: determinism ─────────────────────────────────────────────────

    #[test]
    fn resolve_is_deterministic() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![
                ExecutionInstruction::MoveJ {
                    origin: OperationId("1".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
                ExecutionInstruction::Delay {
                    origin: OperationId("2".to_string()),
                    duration: Duration::from_secs(1),
                },
            ],
            metadata: sample_metadata(),
        };

        let r1 = resolver.resolve(&program).expect("first resolve");
        let r2 = resolver.resolve(&program).expect("second resolve");

        // Compare manually — MotionResolution cannot derive PartialEq
        // because Pose in MotionSegment::MoveL does not implement it.
        assert_eq!(r1.planning.segments.len(), r2.planning.segments.len());
        assert_eq!(r1.runtime.events.len(), r2.runtime.events.len());
        assert_eq!(r1.runtime.events, r2.runtime.events); // RuntimeEvent IS PartialEq
        // Compare segment types
        for (s1, s2) in r1.planning.segments.iter().zip(&r2.planning.segments) {
            assert_eq!(
                std::mem::discriminant(s1),
                std::mem::discriminant(s2),
                "segment variants must match"
            );
        }
    }

    // ── Test: order preservation ──────────────────────────────────────────

    #[test]
    fn motion_segment_order_matches_instruction_order() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![
                ExecutionInstruction::MoveL {
                    origin: OperationId("1".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
                ExecutionInstruction::MoveJ {
                    origin: OperationId("2".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
            ],
            metadata: sample_metadata(),
        };

        let result = resolver.resolve(&program).expect("should resolve");
        assert_eq!(result.planning.segments.len(), 2);
        // First instruction is MoveL, second is MoveJ
        assert!(matches!(
            result.planning.segments[0],
            MotionSegment::MoveL { .. }
        ));
        assert!(matches!(
            result.planning.segments[1],
            MotionSegment::MoveJ { .. }
        ));
    }

    // ── Test: atomic IK failure ───────────────────────────────────────────

    #[test]
    fn ik_failure_returns_error() {
        let ik = FailingIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![ExecutionInstruction::MoveJ {
                origin: OperationId("1".to_string()),
                target: MotionTarget::Pose(sample_pose()),
                profile: default_profile(),
            }],
            metadata: sample_metadata(),
        };

        let result = resolver.resolve(&program);
        assert!(result.is_err());
        match result.unwrap_err() {
            ResolutionError::IkFailed {
                instruction_index, ..
            } => {
                assert_eq!(instruction_index, 0);
            }
            other => panic!("expected IkFailed, got {other:?}"),
        }
    }

    #[test]
    fn ik_failure_on_second_movej_stops_atomically() {
        struct SecondFailsIKSolver {
            call_count: std::sync::Mutex<usize>,
        }

        impl IKSolver for SecondFailsIKSolver {
            fn solve(&self, q0: &[f64], _goal: IKGoal) -> IKResult {
                let mut count = self.call_count.lock().unwrap();
                *count += 1;
                if *count == 2 {
                    IKResult::max_iterations(q0.to_vec(), 1000, 999.0, None)
                } else {
                    IKResult::converged(q0.to_vec(), 1, 0.0, None)
                }
            }
        }

        let ik = SecondFailsIKSolver {
            call_count: std::sync::Mutex::new(0),
        };
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![
                ExecutionInstruction::MoveJ {
                    origin: OperationId("1".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
                ExecutionInstruction::MoveJ {
                    origin: OperationId("2".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
            ],
            metadata: sample_metadata(),
        };

        let result = resolver.resolve(&program);
        assert!(result.is_err());
        match result.unwrap_err() {
            ResolutionError::IkFailed {
                instruction_index, ..
            } => {
                assert_eq!(instruction_index, 1);
            }
            other => panic!("expected IkFailed at index 1, got {other:?}"),
        }
    }

    // ── Test: OperationId origin propagation (IR-1 → IR-2, invariant I2) ──

    #[test]
    fn movej_segment_carries_instruction_origin() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![ExecutionInstruction::MoveJ {
                origin: OperationId("op-j".to_string()),
                target: MotionTarget::Pose(sample_pose()),
                profile: default_profile(),
            }],
            metadata: sample_metadata(),
        };

        let result = resolver.resolve(&program).expect("should resolve");
        assert_eq!(result.planning.segments.len(), 1);
        let seg = &result.planning.segments[0];
        assert_eq!(
            seg.origin(),
            &OperationId("op-j".to_string()),
            "MoveJ segment must carry the instruction origin"
        );
    }

    #[test]
    fn movel_segment_carries_instruction_origin() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![ExecutionInstruction::MoveL {
                origin: OperationId("op-l".to_string()),
                target: MotionTarget::Pose(sample_pose()),
                profile: default_profile(),
            }],
            metadata: sample_metadata(),
        };

        let result = resolver.resolve(&program).expect("should resolve");
        assert_eq!(result.planning.segments.len(), 1);
        let seg = &result.planning.segments[0];
        assert_eq!(
            seg.origin(),
            &OperationId("op-l".to_string()),
            "MoveL segment must carry the instruction origin"
        );
    }

    #[test]
    fn distinct_origins_survive_mixed_program() {
        let ik = NoopIKSolver;
        let registry = make_registry();
        let resolver = make_resolver(&ik, &registry, &[0.0, 0.0]);

        let program = ExecutionProgram {
            instructions: vec![
                ExecutionInstruction::MoveJ {
                    origin: OperationId("pick-1".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
                ExecutionInstruction::SetOutput {
                    origin: OperationId("pick-1".to_string()),
                    channel: OutputChannel {
                        name: "gripper".into(),
                        channel_type: "digital".into(),
                    },
                    value: OutputValue::Bool(true),
                },
                ExecutionInstruction::MoveL {
                    origin: OperationId("place-2".to_string()),
                    target: MotionTarget::Pose(sample_pose()),
                    profile: default_profile(),
                },
            ],
            metadata: sample_metadata(),
        };

        let result = resolver.resolve(&program).expect("should resolve");

        // Planning segments keep their own instruction origins.
        assert_eq!(result.planning.segments.len(), 2);
        assert_eq!(
            result.planning.segments[0].origin(),
            &OperationId("pick-1".to_string())
        );
        assert_eq!(
            result.planning.segments[1].origin(),
            &OperationId("place-2".to_string())
        );

        // Runtime events keep their own instruction origins.
        assert_eq!(result.runtime.events.len(), 1);
        assert_eq!(
            result.runtime.events[0].operation_id,
            OperationId("pick-1".to_string())
        );
    }
}
