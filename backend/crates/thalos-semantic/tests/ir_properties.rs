//! Architectural property tests for the semantic IR pipeline.
//!
//! Validates that `MotionProgram` is a canonical IR that preserves:
//!
//! - **Shape**: each `SemanticOperation` produces the expected instruction structure.
//! - **Traceability**: `OperationId` propagates through all derived instructions.
//! - **Determinism**: same input → same output, always.
//! - **Order**: operations are never reordered during lowering.
//! - **Structural equivalence**: the lowering is a deterministic transformation,
//!   not a black box.

use std::time::Duration;

use thalos_core::ids::OperationId;
use thalos_core::motion::{MotionInstruction, MotionPose, MotionProfile, MotionTarget, OutputValue};
use thalos_semantic::{
    knowledge::{GraspPlan, MockKnowledgeProvider, PlacementPlan},
    lowering::{context::LoweringContext, SemanticLowering},
    operation::{
        HomeOp, MoveToOp, PickOp, PlaceOp, SemanticOperation, WaitOp,
    },
    program::SemanticProgram,
    resource::{LocationId, ObjectId, ToolId},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sample_pose(x: f64, y: f64, z: f64) -> MotionPose {
    MotionPose {
        position: [x, y, z],
        orientation: [0.0, 0.0, 0.0, 1.0],
        frame: "world".into(),
    }
}

fn make_origin(s: &str) -> OperationId {
    OperationId(s.to_string())
}

fn build_provider() -> MockKnowledgeProvider {
    let grasp = GraspPlan {
        grasp_frame: sample_pose(0.5, 0.0, 0.0),
        approach_frame: sample_pose(0.3, 0.0, 0.2),
        retreat_frame: sample_pose(0.6, 0.0, 0.1),
        preferred_tool: Some(ToolId("gripper-1".to_string())),
    };
    let place = PlacementPlan {
        drop_frame: sample_pose(0.4, 0.5, 0.0),
        approach_frame: sample_pose(0.4, 0.3, 0.2),
        retreat_frame: sample_pose(0.4, 0.6, 0.1),
    };

    MockKnowledgeProvider::new()
        .with_grasp_ok(ObjectId("bolt".into()), grasp)
        .with_place_ok(
            ObjectId("bolt".into()),
            LocationId("tray".into()),
            place,
        )
        .with_location_ok(LocationId("station".into()), sample_pose(1.0, 0.0, 0.0))
        .with_home_pose(Ok(sample_pose(0.0, 0.0, 0.0)))
}

fn default_ctx(provider: &MockKnowledgeProvider) -> LoweringContext {
    LoweringContext {
        provider,
        default_tool: Some(ToolId("gripper-1".to_string())),
        default_profile: MotionProfile {
            max_velocity: 1.0,
            max_acceleration: 0.5,
            max_jerk: None,
        },
    }
}

fn lower(program: SemanticProgram) -> Vec<MotionInstruction> {
    let provider = build_provider();
    let ctx = default_ctx(&provider);
    let mp = SemanticLowering::lower(&program, &ctx).expect("lowering should succeed");
    mp.instructions
}

// =========================================================================
// 1. Shape tests — each operation produces the expected instruction pattern
// =========================================================================

#[test]
fn pick_produces_four_instructions() {
    let program = SemanticProgram::new(vec![SemanticOperation::Pick(PickOp {
        origin: make_origin("op-pick"),
        object: ObjectId("bolt".into()),
        tool: None,
    })]);
    let instructions = lower(program);
    assert_eq!(instructions.len(), 4, "Pick should produce exactly 4 instructions");
    // Shape: MoveJ → MoveL → SetOutput → MoveL
    assert!(matches!(instructions[0], MotionInstruction::MoveJ { .. }), "pick[0] should be MoveJ");
    assert!(matches!(instructions[1], MotionInstruction::MoveL { .. }), "pick[1] should be MoveL");
    assert!(matches!(instructions[2], MotionInstruction::SetOutput { .. }), "pick[2] should be SetOutput");
    assert!(matches!(instructions[3], MotionInstruction::MoveL { .. }), "pick[3] should be MoveL");
}

#[test]
fn place_produces_four_instructions() {
    let program = SemanticProgram::new(vec![SemanticOperation::Place(PlaceOp {
        origin: make_origin("op-place"),
        object: ObjectId("bolt".into()),
        destination: LocationId("tray".into()),
        tool: None,
    })]);
    let instructions = lower(program);
    assert_eq!(instructions.len(), 4, "Place should produce exactly 4 instructions");
    assert!(matches!(instructions[0], MotionInstruction::MoveJ { .. }), "place[0] should be MoveJ");
    assert!(matches!(instructions[1], MotionInstruction::MoveL { .. }), "place[1] should be MoveL");
    assert!(matches!(instructions[2], MotionInstruction::SetOutput { .. }), "place[2] should be SetOutput");
    assert!(matches!(instructions[3], MotionInstruction::MoveL { .. }), "place[3] should be MoveL");
}

#[test]
fn move_to_produces_one_instruction() {
    let program = SemanticProgram::new(vec![SemanticOperation::MoveTo(MoveToOp {
        origin: make_origin("op-move"),
        destination: LocationId("station".into()),
        tool: None,
    })]);
    let instructions = lower(program);
    assert_eq!(instructions.len(), 1, "MoveTo should produce exactly 1 instruction");
    assert!(matches!(instructions[0], MotionInstruction::MoveJ { .. }), "MoveTo should produce MoveJ");
}

#[test]
fn wait_produces_one_delay() {
    let program = SemanticProgram::new(vec![SemanticOperation::Wait(WaitOp {
        origin: make_origin("op-wait"),
        duration: Duration::from_millis(500),
    })]);
    let instructions = lower(program);
    assert_eq!(instructions.len(), 1, "Wait should produce exactly 1 instruction");
    assert!(matches!(instructions[0], MotionInstruction::Delay { .. }), "Wait should produce Delay");
}

#[test]
fn home_produces_one_move_j() {
    let program = SemanticProgram::new(vec![SemanticOperation::Home(HomeOp {
        origin: make_origin("op-home"),
    })]);
    let instructions = lower(program);
    assert_eq!(instructions.len(), 1, "Home should produce exactly 1 instruction");
    assert!(matches!(instructions[0], MotionInstruction::MoveJ { .. }), "Home should produce MoveJ");
}

// =========================================================================
// 2. Traceability — OperationId survives through lowering
// =========================================================================

#[test]
fn pick_origin_propagates_to_all_instructions() {
    let origin = make_origin("pick-42");
    let program = SemanticProgram::new(vec![SemanticOperation::Pick(PickOp {
        origin: origin.clone(),
        object: ObjectId("bolt".into()),
        tool: None,
    })]);
    let instructions = lower(program);
    for (i, inst) in instructions.iter().enumerate() {
        let inst_origin = match inst {
            MotionInstruction::MoveJ { origin, .. }
            | MotionInstruction::MoveL { origin, .. }
            | MotionInstruction::SetOutput { origin, .. }
            | MotionInstruction::Delay { origin, .. } => origin,
        };
        assert_eq!(*inst_origin, origin, "instruction {i} should carry origin '{origin}'");
    }
}

#[test]
fn place_origin_propagates_to_all_instructions() {
    let origin = make_origin("place-99");
    let program = SemanticProgram::new(vec![SemanticOperation::Place(PlaceOp {
        origin: origin.clone(),
        object: ObjectId("bolt".into()),
        destination: LocationId("tray".into()),
        tool: None,
    })]);
    let instructions = lower(program);
    for (i, inst) in instructions.iter().enumerate() {
        let inst_origin = match inst {
            MotionInstruction::MoveJ { origin, .. }
            | MotionInstruction::MoveL { origin, .. }
            | MotionInstruction::SetOutput { origin, .. }
            | MotionInstruction::Delay { origin, .. } => origin,
        };
        assert_eq!(*inst_origin, origin, "instruction {i} should carry origin '{origin}'");
    }
}

#[test]
fn home_origin_propagates() {
    let origin = make_origin("home-7");
    let program = SemanticProgram::new(vec![SemanticOperation::Home(HomeOp {
        origin: origin.clone(),
    })]);
    let instructions = lower(program);
    assert_eq!(instructions.len(), 1);
    match &instructions[0] {
        MotionInstruction::MoveJ { origin: o, .. } => {
            assert_eq!(*o, origin);
        }
        other => panic!("Expected MoveJ, got {other:?}"),
    }
}

// =========================================================================
// 3. Determinism — same input always produces the same output
// =========================================================================

#[test]
fn lowering_is_deterministic() {
    let program = SemanticProgram::new(vec![
        SemanticOperation::Pick(PickOp {
            origin: make_origin("op-1"),
            object: ObjectId("bolt".into()),
            tool: None,
        }),
        SemanticOperation::Place(PlaceOp {
            origin: make_origin("op-2"),
            object: ObjectId("bolt".into()),
            destination: LocationId("tray".into()),
            tool: None,
        }),
        SemanticOperation::Wait(WaitOp {
            origin: make_origin("op-3"),
            duration: Duration::from_secs(1),
        }),
        SemanticOperation::Home(HomeOp {
            origin: make_origin("op-4"),
        }),
    ]);

    let provider = build_provider();
    let ctx = default_ctx(&provider);

    let result_a = SemanticLowering::lower(&program, &ctx).expect("first lower");
    let result_b = SemanticLowering::lower(&program, &ctx).expect("second lower");

    assert_eq!(result_a, result_b, "lowering must be deterministic");
}

// =========================================================================
// 4. Order preservation — operations are never reordered
// =========================================================================

#[test]
fn operation_order_is_preserved() {
    let program = SemanticProgram::new(vec![
        SemanticOperation::Wait(WaitOp {
            origin: make_origin("op-1"),
            duration: Duration::from_millis(100),
        }),
        SemanticOperation::Pick(PickOp {
            origin: make_origin("op-2"),
            object: ObjectId("bolt".into()),
            tool: None,
        }),
        SemanticOperation::Home(HomeOp {
            origin: make_origin("op-3"),
        }),
    ]);

    let instructions = lower(program);

    // Wait → Delay
    assert!(matches!(instructions[0], MotionInstruction::Delay { .. }),
        "first operation (Wait) should produce the first instruction");
    // Pick → 4 instructions (MoveJ, MoveL, SetOutput, MoveL)
    assert!(matches!(instructions[1], MotionInstruction::MoveJ { .. }),
        "Pick should start at instruction 1");
    assert!(matches!(instructions[4], MotionInstruction::MoveL { .. }),
        "Pick should end at instruction 4");
    // Home → MoveJ
    assert!(matches!(instructions[5], MotionInstruction::MoveJ { .. }),
        "Home should start at instruction 5");

    assert_eq!(instructions.len(), 6, "Wait(1) + Pick(4) + Home(1) = 6 instructions");
}

// =========================================================================
// 5. Full pipeline — Pick → Wait → Place → Home (cross-cutting)
// =========================================================================

#[test]
fn pick_wait_place_home_full_pipeline() {
    let program = SemanticProgram::new(vec![
        SemanticOperation::Pick(PickOp {
            origin: make_origin("op-pick"),
            object: ObjectId("bolt".into()),
            tool: None,
        }),
        SemanticOperation::Wait(WaitOp {
            origin: make_origin("op-wait"),
            duration: Duration::from_millis(500),
        }),
        SemanticOperation::Place(PlaceOp {
            origin: make_origin("op-place"),
            object: ObjectId("bolt".into()),
            destination: LocationId("tray".into()),
            tool: None,
        }),
        SemanticOperation::Home(HomeOp {
            origin: make_origin("op-home"),
        }),
    ]);

    let instructions = lower(program);

    // Total: Pick(4) + Wait(1) + Place(4) + Home(1) = 10
    assert_eq!(instructions.len(), 10, "full pipeline should produce 10 instructions");

    // ── Pick approach [0]: MoveJ with approach_frame from provider ──
    match &instructions[0] {
        MotionInstruction::MoveJ { target, profile, .. } => {
            assert_eq!(
                *target,
                MotionTarget::Pose(sample_pose(0.3, 0.0, 0.2)),
                "Pick approach should use approach_frame from GraspPlan"
            );
            assert!(profile.max_velocity > 0.0);
        }
        _ => panic!("instructions[0] should be MoveJ (Pick approach)"),
    }

    // ── Pick grasp [1]: MoveL with grasp_frame from provider ──
    match &instructions[1] {
        MotionInstruction::MoveL { target, .. } => {
            assert_eq!(
                *target,
                MotionTarget::Pose(sample_pose(0.5, 0.0, 0.0)),
                "Pick grasp should use grasp_frame from GraspPlan"
            );
        }
        _ => panic!("instructions[1] should be MoveL (Pick grasp)"),
    }

    // ── Pick grip [2]: SetOutput(true) ──
    match &instructions[2] {
        MotionInstruction::SetOutput { channel, value, .. } => {
            assert_eq!(channel.name, "gripper", "Pick grip should use gripper channel");
            assert_eq!(*value, OutputValue::Bool(true), "Pick grip should close gripper (true)");
        }
        _ => panic!("instructions[2] should be SetOutput (Pick grip)"),
    }

    // ── Pick retract [3]: MoveL with retreat_frame from provider ──
    match &instructions[3] {
        MotionInstruction::MoveL { target, .. } => {
            assert_eq!(
                *target,
                MotionTarget::Pose(sample_pose(0.6, 0.0, 0.1)),
                "Pick retract should use retreat_frame from GraspPlan"
            );
        }
        _ => panic!("instructions[3] should be MoveL (Pick retract)"),
    }

    // ── Wait [4]: Delay ──
    match &instructions[4] {
        MotionInstruction::Delay { duration, .. } => {
            assert_eq!(*duration, Duration::from_millis(500));
        }
        _ => panic!("instructions[4] should be Delay"),
    }

    // ── Place approach [5]: MoveJ with approach_frame from provider ──
    match &instructions[5] {
        MotionInstruction::MoveJ { target, .. } => {
            assert_eq!(
                *target,
                MotionTarget::Pose(sample_pose(0.4, 0.3, 0.2)),
                "Place approach should use approach_frame from PlacementPlan"
            );
        }
        _ => panic!("instructions[5] should be MoveJ (Place approach)"),
    }

    // ── Place drop [6]: MoveL with drop_frame from provider ──
    match &instructions[6] {
        MotionInstruction::MoveL { target, .. } => {
            assert_eq!(
                *target,
                MotionTarget::Pose(sample_pose(0.4, 0.5, 0.0)),
                "Place drop should use drop_frame from PlacementPlan"
            );
        }
        _ => panic!("instructions[6] should be MoveL (Place drop)"),
    }

    // ── Place ungrip [7]: SetOutput(false) ──
    match &instructions[7] {
        MotionInstruction::SetOutput { channel, value, .. } => {
            assert_eq!(channel.name, "gripper", "Place ungrip should use gripper channel");
            assert_eq!(*value, OutputValue::Bool(false), "Place ungrip should open gripper (false)");
        }
        _ => panic!("instructions[7] should be SetOutput (Place ungrip)"),
    }

    // ── Place retract [8]: MoveL with retreat_frame from provider ──
    match &instructions[8] {
        MotionInstruction::MoveL { target, .. } => {
            assert_eq!(
                *target,
                MotionTarget::Pose(sample_pose(0.4, 0.6, 0.1)),
                "Place retract should use retreat_frame from PlacementPlan"
            );
        }
        _ => panic!("instructions[8] should be MoveL (Place retract)"),
    }

    // ── Home [9]: MoveJ ──
    match &instructions[9] {
        MotionInstruction::MoveJ { target, .. } => {
            assert_eq!(
                *target,
                MotionTarget::Pose(sample_pose(0.0, 0.0, 0.0)),
                "Home should use home_pose from provider"
            );
        }
        _ => panic!("instructions[9] should be MoveJ (Home)"),
    }

    // Traceability
    for i in 0..4 {
        let origin = match &instructions[i] {
            MotionInstruction::MoveJ { origin, .. }
            | MotionInstruction::MoveL { origin, .. }
            | MotionInstruction::SetOutput { origin, .. } => origin,
            _ => panic!("unexpected instruction type at {i}"),
        };
        assert_eq!(*origin, OperationId("op-pick".to_string()), "instruction {i} should carry Pick origin");
    }
    match &instructions[4] {
        MotionInstruction::Delay { origin, .. } => {
            assert_eq!(*origin, OperationId("op-wait".to_string()));
        }
        _ => panic!("instruction[4] should be Delay"),
    }
    for i in 5..9 {
        let origin = match &instructions[i] {
            MotionInstruction::MoveJ { origin, .. }
            | MotionInstruction::MoveL { origin, .. }
            | MotionInstruction::SetOutput { origin, .. } => origin,
            _ => panic!("unexpected instruction type at {i}"),
        };
        assert_eq!(*origin, OperationId("op-place".to_string()), "instruction {i} should carry Place origin");
    }
    match &instructions[9] {
        MotionInstruction::MoveJ { origin, .. } => {
            assert_eq!(*origin, OperationId("op-home".to_string()));
        }
        _ => panic!("instruction[9] should be MoveJ"),
    }
}

// ── Two independent Pick operations ──
#[test]
fn two_picks_produce_eight_instructions() {
    let program = SemanticProgram::new(vec![
        SemanticOperation::Pick(PickOp {
            origin: make_origin("pick-1"),
            object: ObjectId("bolt".into()),
            tool: None,
        }),
        SemanticOperation::Pick(PickOp {
            origin: make_origin("pick-2"),
            object: ObjectId("bolt".into()),
            tool: None,
        }),
    ]);
    let instructions = lower(program);
    assert_eq!(instructions.len(), 8, "two Picks should produce 8 instructions");
    match &instructions[2] {
        MotionInstruction::SetOutput { value, .. } => {
            assert_eq!(*value, OutputValue::Bool(true), "first Pick grip");
        }
        _ => panic!(),
    }
    match &instructions[6] {
        MotionInstruction::SetOutput { value, .. } => {
            assert_eq!(*value, OutputValue::Bool(true), "second Pick grip");
        }
        _ => panic!(),
    }
}
