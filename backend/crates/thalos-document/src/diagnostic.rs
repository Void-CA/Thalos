//! Diagnostic types for semantic validation.
//!
//! A `Diagnostic` describes a single issue found during semantic validation:
//! severity, code, message, span (where in the document), and optional help text.

/// Severity of a diagnostic — `Error` or `Warning`.
#[derive(Debug, Clone, PartialEq)]
pub enum Severity {
    Error,
    Warning,
}

/// A single semantic validation finding.
///
/// Each Diagnostic pinpoints an issue by operation or resource ID (`span`),
/// provides a human-readable `message`, and may include a `help` suggestion.
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    /// Whether this is a hard error or a soft warning.
    pub severity: Severity,
    /// Machine-readable error code (e.g. `"unresolved-resource"`).
    pub code: String,
    /// Human-readable description of the issue.
    pub message: String,
    /// Location in the document — operation ID or resource ID.
    pub span: String,
    /// Optional suggestion for resolving the issue.
    pub help: Option<String>,
}

impl Diagnostic {
    /// Create a new error-level diagnostic.
    pub fn error(
        code: impl Into<String>,
        message: impl Into<String>,
        span: impl Into<String>,
    ) -> Self {
        Self {
            severity: Severity::Error,
            code: code.into(),
            message: message.into(),
            span: span.into(),
            help: None,
        }
    }

    /// Create a new warning-level diagnostic.
    pub fn warning(
        code: impl Into<String>,
        message: impl Into<String>,
        span: impl Into<String>,
    ) -> Self {
        Self {
            severity: Severity::Warning,
            code: code.into(),
            message: message.into(),
            span: span.into(),
            help: None,
        }
    }

    /// Attach a help message to this diagnostic (builder style).
    pub fn with_help(mut self, help: impl Into<String>) -> Self {
        self.help = Some(help.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Construction helpers ---

    #[test]
    fn diagnostic_error_with_all_fields() {
        let d = Diagnostic::error("unresolved-resource", "Point pt_99 not found", "op_3")
            .with_help("Add a Point resource with id 'pt_99'");
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(d.code, "unresolved-resource");
        assert_eq!(d.message, "Point pt_99 not found");
        assert_eq!(d.span, "op_3");
        assert_eq!(
            d.help,
            Some("Add a Point resource with id 'pt_99'".to_string())
        );
    }

    #[test]
    fn diagnostic_warning_no_help() {
        let d = Diagnostic::warning(
            "unknown-profile",
            "Profile 'turbo' is not in vocabulary",
            "op_1",
        );
        assert_eq!(d.severity, Severity::Warning);
        assert_eq!(d.code, "unknown-profile");
        assert!(d.help.is_none());
    }

    // --- Multiple diagnostics in a Vec ---

    #[test]
    fn multiple_diagnostics_collected() {
        let diagnostics = vec![
            Diagnostic::error("unresolved-resource", "missing pt_01", "op_1"),
            Diagnostic::warning("unknown-profile", "turbo unknown", "op_2"),
            Diagnostic::error("unresolved-resource", "missing pt_02", "op_3"),
        ];
        assert_eq!(diagnostics.len(), 3);
        assert!(diagnostics.iter().any(|d| d.span == "op_1"));
        assert!(diagnostics.iter().any(|d| d.span == "op_3"));
    }

    // --- Clone and Debug ---

    #[test]
    fn diagnostic_is_clone_and_debug() {
        let a = Diagnostic::error("code", "msg", "span");
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{:?}", a);
    }
}
