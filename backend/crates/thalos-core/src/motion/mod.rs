pub mod expansion;
pub mod instruction;
pub mod segment;
pub mod target;

use serde::{Deserialize, Serialize};

pub use instruction::*;
pub use target::*;

/// A complete motion program — the bytecode of the platform.
///
/// Contains a linear `Vec<MotionInstruction>` and `MotionMetadata` for
/// provenance. Instructions are self-contained (no implicit state from prior
/// instructions). Order is preserved.
///
/// `MotionProgram` is the contract between lowering (compiler) and execution
/// (backends). Any backend can consume it without depending on the compiler.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MotionProgram {
    pub instructions: Vec<MotionInstruction>,
    pub metadata: MotionMetadata,
}

/// Provenance metadata attached to every `MotionProgram`.
///
/// Exactly two fields: `schema_version` for format evolution detection, and
/// `source_project` for pipeline traceability. Timestamps and compiler build
/// metadata belong in a wrapping `CompilationRecord`, not here — keeping the
/// program deterministic for snapshot testing and caching.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MotionMetadata {
    pub schema_version: u32,
    pub source_project: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::OperationId;
    use crate::motion::target::*;
    use std::time::Duration;

    /// Build a canonical 4-instruction sequence for order tests.
    fn sample_instructions() -> Vec<MotionInstruction> {
        vec![
            MotionInstruction::MoveJ {
                origin: OperationId("1".to_string()),
                target: MotionTarget::Pose(MotionPose {
                    position: [0.0, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: "world".into(),
                }),
                profile: MotionProfile {
                    max_velocity: 500.0,
                    max_acceleration: 1000.0,
                    max_jerk: None,
                },
            },
            MotionInstruction::MoveL {
                origin: OperationId("2".to_string()),
                target: MotionTarget::Pose(MotionPose {
                    position: [1.0, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                    frame: "world".into(),
                }),
                profile: MotionProfile {
                    max_velocity: 250.0,
                    max_acceleration: 500.0,
                    max_jerk: None,
                },
            },
            MotionInstruction::Delay {
                origin: OperationId("3".to_string()),
                duration: Duration::from_secs(2),
            },
            MotionInstruction::SetOutput {
                origin: OperationId("4".to_string()),
                channel: OutputChannel {
                    name: "gripper".into(),
                    channel_type: "digital".into(),
                },
                value: OutputValue::Bool(true),
            },
        ]
    }

    // ── Task 2.3: Empty program valid + iterable + order preservation ──

    #[test]
    fn empty_program_valid() {
        let program = MotionProgram {
            instructions: vec![],
            metadata: MotionMetadata {
                schema_version: 1,
                source_project: "test".into(),
            },
        };
        assert_eq!(program.instructions.len(), 0);
        assert_eq!(program.metadata.schema_version, 1);
        assert_eq!(program.metadata.source_project, "test");
    }

    #[test]
    fn empty_program_iterable() {
        let program = MotionProgram {
            instructions: vec![],
            metadata: MotionMetadata {
                schema_version: 1,
                source_project: "test".into(),
            },
        };
        let count = program.instructions.iter().count();
        assert_eq!(count, 0, "Empty program should yield zero items");
    }

    #[test]
    fn mixed_instructions_preserve_order() {
        let instructions = sample_instructions();
        let program = MotionProgram {
            instructions,
            metadata: MotionMetadata {
                schema_version: 1,
                source_project: "test".into(),
            },
        };

        assert_eq!(program.instructions.len(), 4);
        assert!(
            matches!(program.instructions[0], MotionInstruction::MoveJ { .. }),
            "First instruction should be MoveJ"
        );
        assert!(
            matches!(program.instructions[1], MotionInstruction::MoveL { .. }),
            "Second instruction should be MoveL"
        );
        assert!(
            matches!(program.instructions[2], MotionInstruction::Delay { .. }),
            "Third instruction should be Delay"
        );
        assert!(
            matches!(program.instructions[3], MotionInstruction::SetOutput { .. }),
            "Fourth instruction should be SetOutput"
        );
    }

    // ── Task 2.4 (continued): Metadata construction ────────────────────

    #[test]
    fn metadata_construction() {
        let metadata = MotionMetadata {
            schema_version: 2,
            source_project: "thalos-demo".into(),
        };
        assert_eq!(metadata.schema_version, 2);
        assert_eq!(metadata.source_project, "thalos-demo");
    }
}
