//! Execution trace observation types and analysis.
//!
//! Decoupled from `thalos-runtime`'s `MotionTrace` to avoid a crate dependency.
//! Contains [`TraceSnapshot`], [`SegmentTrace`], [`ExecutionFinding`], and
//! [`analyze_trace()`] — the observation layer of the feedback loop.
//!
//! ## PR 1 scope
//!
//! - [`FindingKind`]: single variant `HighTrackingError`
//! - [`analyze_trace()`]: fixed threshold 0.5°, no configuration
//! - [`TraceSnapshot`]: segment-level summary (not a full execution trace)
//!   with `global_max_tracking_error()`
//!
//! ## Threshold
//!
//! The tracking error threshold is exposed as [`DEFAULT_TRACKING_ERROR_THRESHOLD`]
//! — a public module-level constant. It is intentionally **not configurable** in v1;
//! adding `FeedbackConfig` or `FindingConfig` is deferred until a second finding type
//! justifies the abstraction.

/// Default threshold for `HighTrackingError` findings (degrees).
///
/// A segment whose `max_tracking_error` exceeds this value triggers an
/// [`ExecutionFinding`] with kind [`FindingKind::HighTrackingError`].
///
/// This is fixed for v1. Making it configurable is deferred until a second
/// finding type or per-segment tolerance justifies the abstraction overhead.
pub const DEFAULT_TRACKING_ERROR_THRESHOLD: f64 = 0.5;

/// A summarized snapshot of a single segment's execution metrics.
///
/// **Not** the full execution trace — this is a projection of
/// [`MotionTrace`](https://docs.rs/thalos-runtime/latest/thalos_runtime/execution_boundary/struct.MotionTrace.html)
/// into the metrics the feedback loop needs, avoiding a crate dependency on
/// `thalos-runtime`.
///
/// Each entry in a [`TraceSnapshot`] records the key metrics observed during
/// runtime. For v1, only `max_tracking_error` is tracked.
pub struct SegmentTrace {
    /// Maximum tracking error observed during execution of this segment (degrees).
    pub max_tracking_error: f64,
}

/// An execution trace composed of segment-level traces.
///
/// Decouples the observation layer from `thalos-runtime`'s `MotionTrace`,
/// allowing the feedback loop to work with synthetic traces in tests and
/// real traces behind a trait boundary in production.
pub struct TraceSnapshot {
    /// Per-segment execution data.
    pub segments: Vec<SegmentTrace>,
}

impl TraceSnapshot {
    /// Returns the maximum tracking error across all segments.
    ///
    /// Returns `0.0` for an empty trace (no segments → no error).
    pub fn global_max_tracking_error(&self) -> f64 {
        // GREEN: real logic — fold over all segments
        self.segments
            .iter()
            .map(|s| s.max_tracking_error)
            .fold(0_f64, f64::max)
    }
}

/// The kind of an execution finding.
///
/// Single variant in v1; can be extended with `#[non_exhaustive]` later.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FindingKind {
    /// The segment's tracking error exceeded the acceptable threshold.
    HighTrackingError,
}

/// An observation derived from an execution trace identifying a problem
/// in a specific segment.
///
/// Unlike [`crate::finding::Finding`] (analysis-time findings), this represents
/// a runtime observation from executing a compiled plan.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecutionFinding {
    /// Index of the problematic segment in the `PlanningProgram`.
    pub segment_id: usize,
    /// What kind of problem was observed.
    pub kind: FindingKind,
    /// The observed metric value that triggered the finding.
    pub value: f64,
}

/// Analyzes an execution trace and produces findings for segments whose
/// `max_tracking_error` exceeds the fixed threshold.
///
/// # Threshold
///
/// Uses a hardcoded threshold of **0.5°** for v1. A configurable threshold
/// is deferred until a second finding type or per-segment tolerance justifies
/// the abstraction overhead.
///
/// # Returns
///
/// A `Vec<ExecutionFinding>` — one entry per segment that exceeds the threshold.
/// Returns an empty vec if no segment exceeds the threshold.
pub fn analyze_trace(trace: &TraceSnapshot) -> Vec<ExecutionFinding> {
    const THRESHOLD: f64 = 0.5;
    trace
        .segments
        .iter()
        .enumerate()
        .filter_map(|(i, seg)| {
            if seg.max_tracking_error > THRESHOLD {
                Some(ExecutionFinding {
                    segment_id: i,
                    kind: FindingKind::HighTrackingError,
                    value: seg.max_tracking_error,
                })
            } else {
                None
            }
        })
        .collect()
}

// ============================================================================
// Tests
// ============================================================================
//
// RED / GREEN / TRIANGULATE evidence for every task is recorded in the TDD
// Cycle Evidence table returned at the end.

#[cfg(test)]
mod tests {
    use super::*;

    // ── Task 1.1 RED + GREEN ───────────────────────────────────────────────
    //
    // RED:   test written before production code existed
    // GREEN: analyze_trace() with threshold gate passes this test

    #[test]
    fn test_detects_high_tracking_error() {
        // One segment exceeds 0.5° threshold → produces exactly one finding
        let trace = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.1,
                },
                SegmentTrace {
                    max_tracking_error: 0.8,
                },
                SegmentTrace {
                    max_tracking_error: 0.2,
                },
            ],
        };
        let findings = analyze_trace(&trace);

        assert_eq!(findings.len(), 1, "expected exactly one finding");
        assert_eq!(findings[0].segment_id, 1);
        assert_eq!(findings[0].kind, FindingKind::HighTrackingError);
        assert!(
            (findings[0].value - 0.8).abs() < f64::EPSILON,
            "expected value 0.8, got {}",
            findings[0].value
        );
    }

    // ── Task 1.3 RED + GREEN ───────────────────────────────────────────────
    //
    // RED:   test written before threshold gate existed
    // GREEN: threshold gate added to analyze_trace()

    #[test]
    fn test_no_finding_when_all_below_threshold() {
        // All segments strictly below 0.5° → no findings
        let trace = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.1,
                },
                SegmentTrace {
                    max_tracking_error: 0.4,
                },
                SegmentTrace {
                    max_tracking_error: 0.2,
                },
            ],
        };
        let findings = analyze_trace(&trace);

        assert!(
            findings.is_empty(),
            "expected no findings, got {}",
            findings.len()
        );
    }

    // ── Task 1.5 RED + GREEN ───────────────────────────────────────────────
    //
    // RED:   test written before global_max_tracking_error() existed
    // GREEN: implementation via fold(f64::max)

    #[test]
    fn test_global_max_tracking_error_multiple_segments() {
        let trace = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.3,
                },
                SegmentTrace {
                    max_tracking_error: 0.9,
                },
                SegmentTrace {
                    max_tracking_error: 0.5,
                },
            ],
        };
        let max_err = trace.global_max_tracking_error();
        assert!(
            (max_err - 0.9).abs() < f64::EPSILON,
            "expected 0.9, got {max_err}"
        );
    }

    #[test]
    fn test_global_max_tracking_error_empty() {
        let trace = TraceSnapshot { segments: vec![] };
        let max_err = trace.global_max_tracking_error();
        assert!(
            (max_err - 0.0).abs() < f64::EPSILON,
            "expected 0.0 for empty trace, got {max_err}"
        );
    }

    #[test]
    fn test_global_max_tracking_error_single_segment() {
        let trace = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.42,
            }],
        };
        let max_err = trace.global_max_tracking_error();
        assert!(
            (max_err - 0.42).abs() < f64::EPSILON,
            "expected 0.42, got {max_err}"
        );
    }

    // ── Triangulation: analyze_trace edge cases ────────────────────────────

    #[test]
    fn test_analyze_trace_exact_threshold_no_finding() {
        // Exactly at 0.5° is NOT above threshold → no finding
        // Spec says "exceeds the threshold" (strictly greater than)
        let trace = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.5,
            }],
        };
        let findings = analyze_trace(&trace);
        assert!(
            findings.is_empty(),
            "exact threshold should not produce a finding"
        );
    }

    #[test]
    fn test_analyze_trace_empty_trace_no_findings() {
        let trace = TraceSnapshot { segments: vec![] };
        let findings = analyze_trace(&trace);
        assert!(
            findings.is_empty(),
            "empty trace should produce no findings"
        );
    }

    #[test]
    fn test_analyze_trace_multiple_high_segments() {
        // Multiple segments exceed threshold → findings for each
        let trace = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.7,
                },
                SegmentTrace {
                    max_tracking_error: 0.1,
                },
                SegmentTrace {
                    max_tracking_error: 0.9,
                },
            ],
        };
        let findings = analyze_trace(&trace);

        assert_eq!(findings.len(), 2, "expected two findings");
        assert_eq!(findings[0].segment_id, 0);
        assert_eq!(findings[0].value, 0.7);
        assert_eq!(findings[1].segment_id, 2);
        assert_eq!(findings[1].value, 0.9);
    }
}
