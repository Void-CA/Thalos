use crate::diagnostics::NormalizationError;
use crate::ir::IrProgram;

/// Extension point only. Execution pipeline belongs to SDD-003.
///
/// A `CompilerPass` transforms an `IrProgram` into another `IrProgram`,
/// preserving the overall structure while applying optimisations, analyses,
/// or lowering preparations.
///
/// Implementors must be idempotent in the sense that running the same pass
/// twice on the same input produces the same output. The pipeline runner
/// (SDD-003) is responsible for ordering, registration, and composition.
pub trait CompilerPass {
    /// Human-readable pass name for diagnostics and logging.
    fn name(&self) -> &str;

    /// Transform the program, returning the modified program or an error.
    fn transform(&self, program: IrProgram) -> Result<IrProgram, NormalizationError>;
}
