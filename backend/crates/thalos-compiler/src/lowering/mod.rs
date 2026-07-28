//! Lowering module — translates a `PlannedProgram` into a `MotionProgram`
//! using a backend-specific strategy.
//!
//! Lowering is purely mechanical and deterministic: it reads strategy decisions
//! already made during planning and emits motion instructions without heuristics
//! or optimization.

pub mod errors;
pub mod traits;
pub mod scara;
pub mod registry;

pub use errors::LoweringError;
pub use traits::LoweringBackend;
pub use scara::ScaraLowering;
