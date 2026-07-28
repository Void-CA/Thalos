//! `LoweringBackend` trait — the interface between the compiler and a motion
//! backend.
//!
//! Each backend (SCARA, 6-DOF, etc.) implements this trait to translate a
//! `PlannedProgram` into a `MotionProgram`. The trait is object-safe to support
//! dynamic dispatch and backend-specific configuration.

use crate::pipeline::PlannedProgram;
use thalos_core::motion::MotionProgram;

use super::errors::LoweringError;

/// A lowering backend that translates a `PlannedProgram` into a `MotionProgram`.
///
/// # Object safety
///
/// `LoweringBackend` is object-safe: both methods take `&self` and return
/// owned values. This enables `Box<dyn LoweringBackend>` for backends that
/// carry configuration state.
pub trait LoweringBackend {
    /// Return a static identifier for this backend (e.g. `"scara"`).
    fn backend_name(&self) -> &'static str;

    /// Lower a planned program into a motion program.
    ///
    /// The input `PlannedProgram` is passed by reference — it is NOT consumed
    /// by this call. The returned `MotionProgram` contains the backend-specific
    /// instruction sequence.
    fn lower(&self, program: &PlannedProgram) -> Result<MotionProgram, LoweringError>;
}
