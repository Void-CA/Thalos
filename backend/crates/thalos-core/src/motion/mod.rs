pub mod expansion;
pub mod instruction;
pub mod segment;
pub mod target;

pub use target::*;

// Deprecated re-exports — types moved to thalos_core::execution
#[deprecated(note = "Moved to thalos_core::execution::program")]
pub use crate::execution::program::ExecutionProgram as MotionProgram;
#[deprecated(note = "Moved to thalos_core::execution::program")]
pub use crate::execution::program::ExecutionMetadata as MotionMetadata;
#[deprecated(note = "Moved to thalos_core::execution::program")]
pub use crate::execution::program::ExecutionInstruction as MotionInstruction;
