//! Execution trace observation types for the feedback loop.
//!
//! Decoupled from `thalos-runtime`'s `MotionTrace` to avoid a crate dependency.
//! Contains [`TraceSnapshot`] and [`SegmentTrace`] — the segment-level summary
//! consumed by the feedback orchestrator's `Verdict` comparison.
//!
//! ## PR 4d scope
//!
//! The legacy execution-finding observation layer (the trace analyzer, the
//! finding type and its threshold constant) was removed in the phase-6
//! deletion (tasks.md 6.1): the feedback loop now analyzes traces through the
//! canonical `Observation` model (PR 4a ExecutionAnalyzer → Observation;
//! PR 4d orchestrator rewrite). This module keeps only the trace summary types
//! the `Verdict` comparison needs.
//!
//! - [`TraceSnapshot`]: segment-level summary (not a full execution trace)
//!   with `global_max_tracking_error()`

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
        self.segments
            .iter()
            .map(|s| s.max_tracking_error)
            .fold(0_f64, f64::max)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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
}
