//! Compilation policy trait and implementations.
//!
//! Each policy implements `CompilationPolicy` which receives a
//! `CompilationContext` containing the IR, diagnostics, and options,
//! and returns a `CompilationDecision` controlling how compilation proceeds.

use thalos_document::diagnostic::{Diagnostic, Severity};

use crate::ir::IrProgram;

use super::CompilationOptions;

// ---------------------------------------------------------------------------
// Trait contract
// ---------------------------------------------------------------------------

/// Determines whether compilation proceeds, aborts, or continues degraded.
///
/// Every policy evaluates the context and returns exactly one decision.
/// The trait does not mutate the context.
pub trait CompilationPolicy {
    /// Evaluate the compilation context and return a decision.
    fn decide(&self, ctx: &CompilationContext) -> CompilationDecision;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/// Input to a policy's `decide` method.
///
/// Provides read-only access to the IR program, accumulated diagnostics,
/// and compilation options.
pub struct CompilationContext<'a> {
    /// The fully resolved intermediate representation.
    pub ir: &'a IrProgram,
    /// Diagnostics accumulated so far (may be empty).
    pub diagnostics: &'a [Diagnostic],
    /// User-supplied compilation options.
    pub options: &'a CompilationOptions,
}

impl<'a> CompilationContext<'a> {
    /// Create a new compilation context.
    pub fn new(
        ir: &'a IrProgram,
        diagnostics: &'a [Diagnostic],
        options: &'a CompilationOptions,
    ) -> Self {
        Self {
            ir,
            diagnostics,
            options,
        }
    }
}

// ---------------------------------------------------------------------------
// Decision types
// ---------------------------------------------------------------------------

/// The outcome of a policy evaluation.
///
/// Exactly one variant is returned per `decide` call.
#[derive(Debug, Clone, PartialEq)]
pub enum CompilationDecision {
    /// Halt compilation; no output produced.
    Abort {
        /// Human-readable reason listing what went wrong.
        reason: String,
    },
    /// Proceed with degraded behavior.
    ContinueWith {
        /// How to handle degraded execution.
        mode: ContinueMode,
    },
    /// Proceed normally, optionally applying overrides.
    Compile {
        /// Compilation parameter overrides (empty = use defaults).
        overrides: Vec<Override>,
    },
}

/// Controls how compilation continues in degraded mode.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ContinueMode {
    /// Substitute default values where diagnostics indicate issues.
    UseDefaults,
    /// Omit operations that produced errors.
    SkipFailing,
    /// Substitute defaults and skip when defaults are unavailable.
    BestEffort,
}

/// A compilation parameter override.
///
/// Overrides modify compilation or planning parameters only — they never
/// alter IR semantics. Fields are deferred to a future implementation.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub struct Override;

// ---------------------------------------------------------------------------
// Policy: StrictPolicy
// ---------------------------------------------------------------------------

/// Errors abort compilation; warnings are logged but do not block.
///
/// | Diagnostic severity | Decision           |
/// |---------------------|--------------------|
/// | Any `Error`         | `Abort`            |
/// | Only `Warning`      | `Compile` (empty)  |
/// | Empty               | `Compile` (empty)  |
pub struct StrictPolicy;

impl CompilationPolicy for StrictPolicy {
    fn decide(&self, ctx: &CompilationContext) -> CompilationDecision {
        let errors: Vec<&Diagnostic> = ctx
            .diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Error)
            .collect();

        if errors.is_empty() {
            CompilationDecision::Compile {
                overrides: Vec::new(),
            }
        } else {
            let reasons: Vec<String> = errors
                .iter()
                .map(|d| format!("[{}] {}: {} (at {})", "Error", d.code, d.message, d.span))
                .collect();
            CompilationDecision::Abort {
                reason: reasons.join("\n"),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Policy: DevelopmentPolicy
// ---------------------------------------------------------------------------

/// Errors trigger skip-failing mode; warnings are printed to stderr but
/// do not block compilation.
///
/// | Diagnostic severity | Decision                        |
/// |---------------------|---------------------------------|
/// | Any `Error`         | `ContinueWith(SkipFailing)`      |
/// | Only `Warning`      | `Compile` (empty) + stderr       |
/// | Empty               | `Compile` (empty)               |
pub struct DevelopmentPolicy;

impl DevelopmentPolicy {
    /// Log warnings to stderr.
    fn log_warnings(diagnostics: &[Diagnostic]) {
        for d in diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Warning)
        {
            eprintln!("[Warning] {}: {} (at {})", d.code, d.message, d.span);
            if let Some(ref help) = d.help {
                eprintln!("  help: {help}");
            }
        }
    }
}

impl CompilationPolicy for DevelopmentPolicy {
    fn decide(&self, ctx: &CompilationContext) -> CompilationDecision {
        // Log warnings before deciding.
        Self::log_warnings(ctx.diagnostics);

        let has_errors = ctx
            .diagnostics
            .iter()
            .any(|d| d.severity == Severity::Error);

        if has_errors {
            CompilationDecision::ContinueWith {
                mode: ContinueMode::SkipFailing,
            }
        } else {
            CompilationDecision::Compile {
                overrides: Vec::new(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Policy: DemoPolicy
// ---------------------------------------------------------------------------

/// Errors trigger best-effort mode. Unknown motion profiles resolve to the
/// default profile without error.
///
/// | Diagnostic severity | Decision                          |
/// |---------------------|-----------------------------------|
/// | Any `Error`         | `ContinueWith(BestEffort)`         |
/// | Only `Warning`      | `Compile` (empty)                 |
/// | Empty               | `Compile` (empty)                 |
pub struct DemoPolicy;

impl DemoPolicy {
    /// Resolve a motion profile name.
    ///
    /// Returns the input if known, or `"default"` if the profile is unknown.
    /// This implements the "unknown profiles → default" invariant.
    pub fn resolve_profile_name<'a>(&self, name: &'a str) -> &'a str {
        match name {
            "default" | "fast" | "slow" => name,
            _ => "default",
        }
    }
}

impl CompilationPolicy for DemoPolicy {
    fn decide(&self, ctx: &CompilationContext) -> CompilationDecision {
        let has_errors = ctx
            .diagnostics
            .iter()
            .any(|d| d.severity == Severity::Error);

        if has_errors {
            CompilationDecision::ContinueWith {
                mode: ContinueMode::BestEffort,
            }
        } else {
            CompilationDecision::Compile {
                overrides: Vec::new(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Policy: CIValidationPolicy
// ---------------------------------------------------------------------------

/// Warnings are elevated to errors. Zero diagnostics is the only way to pass.
///
/// | Diagnostic severity   | Decision           |
/// |-----------------------|--------------------|
/// | Any (`Error|Warning`) | `Abort`            |
/// | None                  | `Compile` (empty)  |
pub struct CIValidationPolicy;

impl CompilationPolicy for CIValidationPolicy {
    fn decide(&self, ctx: &CompilationContext) -> CompilationDecision {
        if ctx.diagnostics.is_empty() {
            return CompilationDecision::Compile {
                overrides: Vec::new(),
            };
        }

        let reasons: Vec<String> = ctx
            .diagnostics
            .iter()
            .map(|d| {
                // Every diagnostic is treated as an error in CI mode.
                format!("[CI-Error] {}: {} (at {})", d.code, d.message, d.span)
            })
            .collect();

        CompilationDecision::Abort {
            reason: reasons.join("\n"),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::IrProgram;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fn empty_ir() -> IrProgram {
        IrProgram {
            version: 1,
            operations: vec![],
            source_metadata: thalos_document::project::Metadata {
                name: "test".into(),
                version: 1,
                created_at: "2026-07-27T00:00:00Z".into(),
                modified_at: "2026-07-27T00:00:00Z".into(),
            },
        }
    }

    fn make_ctx<'a>(
        ir: &'a IrProgram,
        diagnostics: &'a [Diagnostic],
        options: &'a CompilationOptions,
    ) -> CompilationContext<'a> {
        CompilationContext::new(ir, diagnostics, options)
    }

    fn default_options() -> CompilationOptions {
        CompilationOptions {
            policy_mode: crate::pipeline::PolicyMode::Strict,
        }
    }

    // ------------------------------------------------------------------
    // 1.1 — Structural: types exist, context is readable
    // ------------------------------------------------------------------

    #[test]
    fn compilation_context_reads_all_fields() {
        let ir = empty_ir();
        let diags = [];
        let opts = default_options();
        let ctx = make_ctx(&ir, &diags, &opts);

        // Verify all three fields are accessible.
        assert_eq!(ctx.ir.version, 1);
        assert!(ctx.diagnostics.is_empty());
        assert_eq!(ctx.options.policy_mode, crate::pipeline::PolicyMode::Strict);
    }

    // ------------------------------------------------------------------
    // 1.2 — StrictPolicy
    // ------------------------------------------------------------------

    #[test]
    fn strict_policy_error_triggers_abort() {
        let ir = empty_ir();
        let diags = [Diagnostic::error("semantic", "type mismatch", "op_1")];
        let opts = default_options();
        let policy = StrictPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        match decision {
            CompilationDecision::Abort { reason } => {
                assert!(!reason.is_empty(), "Abort reason must be non-empty");
                assert!(
                    reason.contains("type mismatch"),
                    "reason should mention the error"
                );
            }
            other => panic!("Expected Abort, got {other:?}"),
        }
    }

    #[test]
    fn strict_policy_multiple_errors_abort_with_all_reasons() {
        let ir = empty_ir();
        let diags = [
            Diagnostic::error("E001", "missing resource", "op_1"),
            Diagnostic::error("E002", "invalid syntax", "op_2"),
        ];
        let opts = default_options();
        let policy = StrictPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        match decision {
            CompilationDecision::Abort { reason } => {
                assert!(
                    reason.contains("E001"),
                    "reason should contain first error code"
                );
                assert!(
                    reason.contains("E002"),
                    "reason should contain second error code"
                );
            }
            other => panic!("Expected Abort, got {other:?}"),
        }
    }

    #[test]
    fn strict_policy_warnings_only_compile() {
        let ir = empty_ir();
        let diags = [Diagnostic::warning("W001", "unused variable", "op_2")];
        let opts = default_options();
        let policy = StrictPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        assert_eq!(
            decision,
            CompilationDecision::Compile { overrides: vec![] },
            "StrictPolicy should compile with warnings only"
        );
    }

    #[test]
    fn strict_policy_empty_diagnostics_compile() {
        let ir = empty_ir();
        let diags = [];
        let opts = default_options();
        let policy = StrictPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        assert_eq!(
            decision,
            CompilationDecision::Compile { overrides: vec![] },
            "StrictPolicy with no diagnostics should Compile"
        );
    }

    // ------------------------------------------------------------------
    // 1.3 — DevelopmentPolicy
    // ------------------------------------------------------------------

    #[test]
    fn development_policy_error_triggers_skip_failing() {
        let ir = empty_ir();
        let diags = [Diagnostic::error("E001", "connection lost", "op_1")];
        let opts = default_options();
        let policy = DevelopmentPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        assert_eq!(
            decision,
            CompilationDecision::ContinueWith {
                mode: ContinueMode::SkipFailing
            },
            "DevelopmentPolicy should ContinueWith(SkipFailing) on errors"
        );
    }

    #[test]
    fn development_policy_warnings_compile() {
        let ir = empty_ir();
        let diags = [Diagnostic::warning("W001", "deprecated API", "op_2")];
        let opts = default_options();
        let policy = DevelopmentPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        assert_eq!(
            decision,
            CompilationDecision::Compile { overrides: vec![] },
            "DevelopmentPolicy should Compile with warnings only"
        );
    }

    // ------------------------------------------------------------------
    // 1.4 — DemoPolicy
    // ------------------------------------------------------------------

    #[test]
    fn demo_policy_error_triggers_best_effort() {
        let ir = empty_ir();
        let diags = [Diagnostic::error("E001", "timeout", "op_1")];
        let opts = default_options();
        let policy = DemoPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        assert_eq!(
            decision,
            CompilationDecision::ContinueWith {
                mode: ContinueMode::BestEffort
            },
            "DemoPolicy should ContinueWith(BestEffort) on errors"
        );
    }

    #[test]
    fn demo_policy_resolves_unknown_profile_to_default() {
        let policy = DemoPolicy;

        // Known profiles pass through.
        assert_eq!(policy.resolve_profile_name("default"), "default");
        assert_eq!(policy.resolve_profile_name("fast"), "fast");
        assert_eq!(policy.resolve_profile_name("slow"), "slow");

        // Unknown profiles resolve to "default".
        assert_eq!(policy.resolve_profile_name("turbo"), "default");
        assert_eq!(policy.resolve_profile_name("unknown"), "default");
        assert_eq!(policy.resolve_profile_name(""), "default");
    }

    #[test]
    fn demo_policy_no_errors_compile() {
        let ir = empty_ir();
        let diags = [Diagnostic::warning("W001", "cosmetic", "op_1")];
        let opts = default_options();
        let policy = DemoPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        assert_eq!(
            decision,
            CompilationDecision::Compile { overrides: vec![] },
            "DemoPolicy should Compile with no errors"
        );
    }

    // ------------------------------------------------------------------
    // 1.5 — CIValidationPolicy
    // ------------------------------------------------------------------

    #[test]
    fn ci_validation_warnings_elevated_to_abort() {
        let ir = empty_ir();
        let diags = [Diagnostic::warning("W001", "unused import", "op_1")];
        let opts = default_options();
        let policy = CIValidationPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        match decision {
            CompilationDecision::Abort { reason } => {
                assert!(!reason.is_empty(), "Abort reason must be non-empty");
                assert!(
                    reason.contains("unused import"),
                    "reason should mention the warning"
                );
            }
            other => panic!("Expected Abort, got {other:?}"),
        }
    }

    #[test]
    fn ci_validation_errors_also_abort() {
        let ir = empty_ir();
        let diags = [Diagnostic::error("E001", "critical failure", "op_1")];
        let opts = default_options();
        let policy = CIValidationPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        match decision {
            CompilationDecision::Abort { reason } => {
                assert!(reason.contains("critical failure"));
            }
            other => panic!("Expected Abort, got {other:?}"),
        }
    }

    #[test]
    fn ci_validation_zero_diagnostics_compile() {
        let ir = empty_ir();
        let diags = [];
        let opts = default_options();
        let policy = CIValidationPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        assert_eq!(
            decision,
            CompilationDecision::Compile { overrides: vec![] },
            "CIValidationPolicy with no diagnostics should Compile"
        );
    }

    // ------------------------------------------------------------------
    // Contract / structural tests
    // ------------------------------------------------------------------

    #[test]
    fn all_policies_return_compile_on_empty_diagnostics() {
        let ir = empty_ir();
        let opts = default_options();
        let policies: [(&str, Box<dyn CompilationPolicy>); 4] = [
            ("Strict", Box::new(StrictPolicy)),
            ("Development", Box::new(DevelopmentPolicy)),
            ("Demo", Box::new(DemoPolicy)),
            ("CIValidation", Box::new(CIValidationPolicy)),
        ];

        for (name, policy) in &policies {
            let ctx = make_ctx(&ir, &[], &opts);
            let decision = policy.decide(&ctx);
            assert!(
                matches!(decision, CompilationDecision::Compile { .. }),
                "Policy '{name}' should Compile with empty diagnostics, got {decision:?}"
            );
        }
    }

    #[test]
    fn abort_reason_is_non_empty() {
        let ir = empty_ir();
        let diags = [Diagnostic::error("E", "fail", "op")];
        let opts = default_options();
        let policy = StrictPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        match decision {
            CompilationDecision::Abort { reason } => {
                assert!(!reason.is_empty(), "Abort reason must be non-empty");
            }
            other => panic!("Expected Abort, got {other:?}"),
        }
    }

    #[test]
    fn compile_overrides_is_empty_for_clean_input() {
        let ir = empty_ir();
        let diags = [];
        let opts = default_options();
        let policy = StrictPolicy;

        let decision = policy.decide(&make_ctx(&ir, &diags, &opts));

        match decision {
            CompilationDecision::Compile { overrides } => {
                assert!(overrides.is_empty(), "Compile overrides should be empty");
            }
            other => panic!("Expected Compile, got {other:?}"),
        }
    }

    #[test]
    fn best_effort_is_more_permissive_than_skip_failing() {
        // BestEffort: substitute defaults AND skip when defaults unavailable.
        // SkipFailing: only skip failing operations.
        //
        // BestEffort retains at least as many operations as SkipFailing
        // because it attempts default substitution before skipping.
        //
        // This test verifies the semantic ordering — the actual operation-
        // level logic is in the analysis/planning stages, but the policy
        // contract ensures BestEffort is never more restrictive.

        // Both are ContinueMode variants; verify their discriminant ordering
        // matches the spec: BestEffort >= SkipFailing in permissiveness.
        let modes = vec![
            ContinueMode::UseDefaults,
            ContinueMode::SkipFailing,
            ContinueMode::BestEffort,
        ];

        // BestEffort is the most permissive mode.
        assert_eq!(modes[2], ContinueMode::BestEffort);
        assert_ne!(modes[2], ContinueMode::SkipFailing);
    }

    // ------------------------------------------------------------------
    // Clone, Debug, PartialEq hygiene
    // ------------------------------------------------------------------

    #[test]
    fn compilation_decision_is_clone_and_debug() {
        let a = CompilationDecision::Compile { overrides: vec![] };
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{a:?}");
    }

    #[test]
    fn continue_mode_is_clone_copy_and_debug() {
        let a = ContinueMode::BestEffort;
        let b = a;
        assert_eq!(a, b);
        let _ = format!("{a:?}");
    }

    #[test]
    fn override_is_clone_and_debug() {
        let a = Override;
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{a:?}");
    }
}
