use crate::motion::program::PlanningProgram;
use thalos_core::execution::runtime::RuntimeProgram;

/// The result of resolving an `ExecutionProgram` into planning and runtime
/// components.
///
/// - `planning`: contains all motion segments (MoveJ, MoveL) in program order.
/// - `runtime`:  contains all runtime events (Delay, SetOutput) in program order.
///
/// Both streams together cover all instructions from the original program
/// (invariant: completeness). No instruction produces elements in both streams.
#[derive(Debug, Clone)]
pub struct MotionResolution {
    pub planning: PlanningProgram,
    pub runtime: RuntimeProgram,
}

/// Errors that can occur during motion resolution.
///
/// Resolution is atomic — on any error, no partial `MotionResolution` is
/// returned and the caller must treat the entire program as unresolved.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolutionError {
    /// The IK solver failed to converge for a MoveJ instruction.
    IkFailed {
        /// 0-based index of the instruction that caused the failure.
        instruction_index: usize,
        /// Human-readable reason from the IK solver.
        reason: String,
    },
    /// A frame name referenced in a MoveL instruction could not be resolved.
    UnknownFrame(String),
}

impl std::fmt::Display for ResolutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolutionError::IkFailed {
                instruction_index,
                reason,
            } => {
                write!(
                    f,
                    "IK failed for instruction {}: {reason}",
                    instruction_index + 1
                )
            }
            ResolutionError::UnknownFrame(frame) => {
                write!(f, "unknown frame: {frame}")
            }
        }
    }
}

impl std::error::Error for ResolutionError {}
