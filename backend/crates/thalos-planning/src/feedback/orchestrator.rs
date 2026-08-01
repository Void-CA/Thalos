//! Feedback loop orchestrator — coordinates the full planning feedback cycle.
//!
//! This is the coordination layer (PR 3) of the feedback loop. It receives:
//!
//! - A [`PlanExecutor`] for compiling and executing `PlanningProgram`s.
//! - A registry of [`IntentionOperator`]s for transforming problematic segments.
//!
//! The orchestrator never implements analysis, transformation, or comparison
//! logic — it delegates each responsibility to the appropriate component.
//!
//! ## Cycle
//!
//! 1. Execute original program
//! 2. Analyze trace for [`ExecutionFinding`]s
//! 3. If no findings → [`Verdict::NoActionNeeded`]
//! 4. Find first-applicable operator (no ranking)
//! 5. Apply operator → [`TransformationCandidate`]
//! 6. Build new `PlanningProgram` with substituted segments
//! 7. Re-execute
//! 8. Compare: [`Verdict::from_comparison`]
//!
//! ## Constraints
//!
//! - No concrete operator imports — receives `Vec<Box<dyn IntentionOperator>>`.
//! - First-applicable operator wins — no ranking, no scoring.
//! - Comparison math lives in `Verdict` — orchestrator never implements it.
//! - [`FeedbackError`] is kept minimal (single variant for v1).

use thalos_core::motion::segment::MotionSegment;

use crate::feedback::finding::{ExecutionFinding, TraceSnapshot, analyze_trace};
use crate::feedback::operator::IntentionOperator;
use crate::motion::program::PlanningProgram;

// ============================================================================
// Verdict
// ============================================================================

/// Result of comparing execution quality before and after transformation.
///
/// The comparison logic lives here — consumers (including the orchestrator)
/// call [`Verdict::from_comparison`] and never implement comparison math.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// The transformation improved execution quality.
    Accept {
        /// Original (pre-transformation) global max tracking error.
        original_error: f64,
        /// New (post-transformation) global max tracking error.
        new_error: f64,
    },
    /// The transformation worsened or did not improve execution quality.
    Reject {
        /// Original (pre-transformation) global max tracking error.
        original_error: f64,
        /// New (post-transformation) global max tracking error.
        new_error: f64,
    },
    /// No transformation was needed or applied.
    NoActionNeeded,
}

impl Verdict {
    /// Compares two execution traces and returns the appropriate verdict.
    ///
    /// A transformation is accepted only when:
    /// ```text
    /// max_tracking_error(new_trace) < max_tracking_error(original_trace)
    /// ```
    ///
    /// Equal or worse error produces [`Verdict::Reject`].
    /// This method is the **only** place comparison math lives — callers
    /// (including the orchestrator) delegate here.
    pub fn from_comparison(original: &TraceSnapshot, new: &TraceSnapshot) -> Self {
        let original_error = original.global_max_tracking_error();
        let new_error = new.global_max_tracking_error();

        if new_error < original_error {
            Verdict::Accept {
                original_error,
                new_error,
            }
        } else {
            Verdict::Reject {
                original_error,
                new_error,
            }
        }
    }
}

// ============================================================================
// TransformationCandidate
// ============================================================================

/// Records the result of applying an [`IntentionOperator`] to a segment.
///
/// Preserves provenance for logging and audit: which operator ran, which
/// segment it replaced, and what it produced. This is a pure internal type
/// with no serialization contract.
#[derive(Debug)]
pub struct TransformationCandidate {
    /// Human-readable name of the operator that produced this result.
    pub operator_name: &'static str,
    /// Index of the segment being replaced in the original `PlanningProgram`.
    pub segment_id: usize,
    /// The replacement segments produced by the operator.
    pub replacement_segments: Vec<MotionSegment>,
}

// ============================================================================
// FeedbackError
// ============================================================================

/// Errors that can occur during the feedback cycle.
///
/// Kept minimal for v1 — only `ExecutionFailed` exists. New variants can
/// be added as the feedback loop gains capability (e.g. operator errors,
/// analysis errors, configuration errors).
#[derive(Debug)]
pub enum FeedbackError {
    /// Execution of a motion program failed.
    ExecutionFailed(String),
}

impl std::fmt::Display for FeedbackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FeedbackError::ExecutionFailed(msg) => write!(f, "execution failed: {msg}"),
        }
    }
}

impl std::error::Error for FeedbackError {}

// ============================================================================
// PlanExecutor trait
// ============================================================================

/// Abstracts compilation and execution of a [`PlanningProgram`].
///
/// The implementation handles `PlanCompiler` internally — the orchestrator
/// only coordinates the cycle. This trait decouples the feedback loop from
/// `thalos-runtime`, allowing tests to use mocked executors.
///
/// # Sync requirement
///
/// Implementations must be [`Send`] + [`Sync`] so the orchestrator can hold
/// them behind `Box<dyn PlanExecutor>`.
///
/// # Async note
///
/// Currently synchronous. A real executor backed by `thalos-runtime` would
/// be async; the signature can be changed when that implementation exists.
pub trait PlanExecutor: Send + Sync {
    /// Compile and execute a `PlanningProgram`.
    ///
    /// Returns a [`TraceSnapshot`] with per-segment metrics. Errors are
    /// reported via [`FeedbackError::ExecutionFailed`].
    fn execute_program(&self, program: &PlanningProgram) -> Result<TraceSnapshot, FeedbackError>;
}

// ============================================================================
// Helper functions (private)
// ============================================================================

/// Selects the first [`IntentionOperator`] whose `applies_to()` returns `true`.
///
/// Returns `None` when no operator is applicable. Operators are iterated in
/// registration order — the order has no algorithmic meaning (no ranking).
fn select_operator<'a>(
    operators: &'a [Box<dyn IntentionOperator>],
    segment: &MotionSegment,
    finding: &ExecutionFinding,
) -> Option<&'a dyn IntentionOperator> {
    operators
        .iter()
        .find(|op| op.applies_to(segment, finding))
        .map(|op| op.as_ref())
}

/// Builds a new [`PlanningProgram`] by replacing one segment with alternatives.
///
/// The original segment at `candidate.segment_id` is removed and replaced
/// with `candidate.replacement_segments`. The replacement vec may have any
/// length (one-to-one, one-to-many, or one-to-zero).
fn build_modified_program(
    original: &PlanningProgram,
    candidate: &TransformationCandidate,
) -> PlanningProgram {
    let mut segments = original.segments.clone();
    let _ = segments.splice(
        candidate.segment_id..=candidate.segment_id,
        candidate.replacement_segments.clone(),
    );
    PlanningProgram::new(segments)
}

// ============================================================================
// FeedbackOrchestrator
// ============================================================================

/// Coordinates the full planning feedback cycle.
///
/// Holds an executor and an operator registry. The [`run()`](FeedbackOrchestrator::run)
/// method orchestrates the cycle but never implements analysis, transformation,
/// or comparison logic.
pub struct FeedbackOrchestrator {
    /// Abstracts compilation and execution (decouples from `thalos-runtime`).
    executor: Box<dyn PlanExecutor>,
    /// Operator registry — receives at construction, never instantiates.
    operators: Vec<Box<dyn IntentionOperator>>,
}

impl FeedbackOrchestrator {
    /// Creates a new orchestrator with the given executor and operator registry.
    ///
    /// The operator registry is ordered but the order has no algorithmic
    /// meaning — only first-applicable selection is used.
    pub fn new(
        executor: Box<dyn PlanExecutor>,
        operators: Vec<Box<dyn IntentionOperator>>,
    ) -> Self {
        Self {
            executor,
            operators,
        }
    }

    /// Runs the full feedback cycle on a motion program.
    ///
    /// ## Steps
    ///
    /// 1. Execute the original program.
    /// 2. Analyze the execution trace for findings.
    /// 3. If no findings → return [`Verdict::NoActionNeeded`] early.
    /// 4. Find the first-applicable operator (no ranking).
    /// 5. Apply the operator → [`TransformationCandidate`].
    /// 6. Build a modified `PlanningProgram` with substituted segments.
    /// 7. Re-execute the modified program.
    /// 8. Compare original vs new trace → return [`Verdict`].
    pub fn run(&self, program: &PlanningProgram) -> Result<Verdict, FeedbackError> {
        // 1. Execute original program
        let original_trace = self.executor.execute_program(program)?;

        // 2. Analyze trace for findings
        let findings = analyze_trace(&original_trace);

        // 3. Early return when no findings (clean trace → NoActionNeeded)
        if findings.is_empty() {
            return Ok(Verdict::NoActionNeeded);
        }

        // Take the first finding (v1 operates on one finding per cycle)
        let finding = &findings[0];
        let segment = &program.segments[finding.segment_id];

        // 4. Find first-applicable operator
        let operator = select_operator(&self.operators, segment, finding).ok_or_else(|| {
            FeedbackError::ExecutionFailed("no applicable operator for finding".to_string())
        })?;

        // 5. Apply operator → TransformationCandidate
        let replacement_segments = operator
            .apply(segment, finding)
            .map_err(|e| FeedbackError::ExecutionFailed(e.to_string()))?;

        let candidate = TransformationCandidate {
            operator_name: operator.name(),
            segment_id: finding.segment_id,
            replacement_segments,
        };

        // 6. Build new PlanningProgram with substituted segments
        let new_program = build_modified_program(program, &candidate);

        // 7. Re-execute
        let new_trace = self.executor.execute_program(&new_program)?;

        // 8. Compare — delegate to Verdict (orchestrator never does math)
        Ok(Verdict::from_comparison(&original_trace, &new_trace))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Mutex;

    use thalos_core::ids::OperationId;
    use thalos_core::motion::segment::MotionSegment;
    use thalos_core::prelude::{FrameId, Pose, Transform3D};

    use crate::feedback::finding::SegmentTrace;
    use crate::feedback::operator::TransformationError;

    // ======================================================================
    // Mock types
    // ======================================================================

    /// Mock executor that returns pre-programmed traces.
    ///
    /// Each call to `execute_program` pops the next result from the vec.
    /// The vec MUST contain at least as many results as the number of calls.
    struct MockExecutor {
        results: Mutex<Vec<Result<TraceSnapshot, FeedbackError>>>,
    }

    impl MockExecutor {
        fn new(results: Vec<Result<TraceSnapshot, FeedbackError>>) -> Self {
            Self {
                results: Mutex::new(results),
            }
        }
    }

    impl PlanExecutor for MockExecutor {
        fn execute_program(
            &self,
            _program: &PlanningProgram,
        ) -> Result<TraceSnapshot, FeedbackError> {
            let mut results = self.results.lock().expect("mock executor lock");
            #[allow(clippy::panic)]
            // Panic is acceptable in test-only mock code
            results.remove(0)
        }
    }

    /// Mock operator that returns configurable applicability and replacements.
    struct MockOperator {
        name: &'static str,
        applies: bool,
        replacement: Vec<MotionSegment>,
    }

    impl MockOperator {
        #[allow(dead_code)]
        fn new(name: &'static str, applies: bool, replacement: Vec<MotionSegment>) -> Self {
            Self {
                name,
                applies,
                replacement,
            }
        }
    }

    impl IntentionOperator for MockOperator {
        fn name(&self) -> &'static str {
            self.name
        }

        fn applies_to(&self, _segment: &MotionSegment, _finding: &ExecutionFinding) -> bool {
            self.applies
        }

        fn apply(
            &self,
            _segment: &MotionSegment,
            _finding: &ExecutionFinding,
        ) -> Result<Vec<MotionSegment>, TransformationError> {
            Ok(self.replacement.clone())
        }
    }

    // ======================================================================
    // Helpers
    // ======================================================================

    fn make_move_l() -> MotionSegment {
        MotionSegment::MoveL {
            origin: OperationId("test".into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity: None,
        }
    }

    // ======================================================================
    // Task 3.1 RED + Task 3.2 GREEN — Verdict comparison
    //
    // RED:   test written before Verdict::from_comparison existed
    // GREEN: Verdict enum + from_comparison created
    // ======================================================================

    #[test]
    fn test_verdict_accepts_improvement_08_to_03() {
        let original = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };
        let new = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.3,
            }],
        };

        let verdict = Verdict::from_comparison(&original, &new);

        match verdict {
            Verdict::Accept {
                original_error,
                new_error,
            } => {
                assert!(
                    (original_error - 0.8).abs() < f64::EPSILON,
                    "expected original_error 0.8, got {original_error}"
                );
                assert!(
                    (new_error - 0.3).abs() < f64::EPSILON,
                    "expected new_error 0.3, got {new_error}"
                );
            }
            other => panic!("expected Accept, got {other:?}"),
        }
    }

    #[test]
    fn test_verdict_rejects_degradation_03_to_09() {
        let original = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.3,
            }],
        };
        let new = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.9,
            }],
        };

        let verdict = Verdict::from_comparison(&original, &new);

        match verdict {
            Verdict::Reject {
                original_error,
                new_error,
            } => {
                assert!(
                    (original_error - 0.3).abs() < f64::EPSILON,
                    "expected original_error 0.3, got {original_error}"
                );
                assert!(
                    (new_error - 0.9).abs() < f64::EPSILON,
                    "expected new_error 0.9, got {new_error}"
                );
            }
            other => panic!("expected Reject, got {other:?}"),
        }
    }

    // ── Triangulation: Verdict edge cases ──────────────────────────────────

    #[test]
    fn test_verdict_same_error_is_reject() {
        // Equal error is NOT an improvement → Reject
        let original = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.5,
            }],
        };
        let new = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.5,
            }],
        };

        let verdict = Verdict::from_comparison(&original, &new);
        assert!(
            matches!(verdict, Verdict::Reject { .. }),
            "equal error should be Reject, got {verdict:?}"
        );
    }

    #[test]
    fn test_verdict_multi_segment_global_max() {
        // Global max across multiple segments
        let original = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.2,
                },
                SegmentTrace {
                    max_tracking_error: 0.9,
                },
                SegmentTrace {
                    max_tracking_error: 0.3,
                },
            ],
        };
        let new = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.2,
                },
                SegmentTrace {
                    max_tracking_error: 0.4,
                },
                SegmentTrace {
                    max_tracking_error: 0.3,
                },
            ],
        };

        let verdict = Verdict::from_comparison(&original, &new);
        match verdict {
            Verdict::Accept {
                original_error,
                new_error,
            } => {
                assert!(
                    (original_error - 0.9).abs() < f64::EPSILON,
                    "expected global max 0.9, got {original_error}"
                );
                assert!(
                    (new_error - 0.4).abs() < f64::EPSILON,
                    "expected global max 0.4, got {new_error}"
                );
            }
            other => panic!("expected Accept for improving global max, got {other:?}"),
        }
    }

    // ======================================================================
    // Task 3.3 GREEN — PlanExecutor trait (structural — no RED test)
    //
    // The trait is a structural contract. It is tested indirectly through
    // all orchestrator tests that use MockExecutor.
    // Triangulation skipped: purely structural trait definition.
    // ======================================================================

    // ======================================================================
    // Task 3.4 RED + Task 3.5 GREEN — FeedbackOrchestrator constructor
    //
    // RED:   test written before FeedbackOrchestrator existed
    // GREEN: FeedbackOrchestrator struct + new() created
    // ======================================================================

    #[test]
    fn test_orchestrator_constructor_accepts_executor_and_operators() {
        let executor = MockExecutor::new(vec![]);
        let operators: Vec<Box<dyn IntentionOperator>> = vec![];

        let orch = FeedbackOrchestrator::new(Box::new(executor), operators);

        // Verify the struct compiles and is Send + Sync
        fn is_send_sync<T: Send + Sync>() {}
        is_send_sync::<FeedbackOrchestrator>();

        // Verify basic construction succeeded by checking the type exists
        let _ = orch;
    }

    #[test]
    fn test_orchestrator_constructor_with_operators() {
        let executor = MockExecutor::new(vec![]);
        let op = MockOperator::new("op1", true, vec![]);
        let operators: Vec<Box<dyn IntentionOperator>> = vec![Box::new(op)];

        let orch = FeedbackOrchestrator::new(Box::new(executor), operators);
        let _ = orch;
    }

    // ======================================================================
    // Task 3.6 RED + Task 3.7 GREEN — Full cycle with improvement
    //
    // RED:   test written before FeedbackOrchestrator::run() existed
    // GREEN: run() implemented with full cycle logic
    // ======================================================================

    #[test]
    fn test_full_cycle_with_improvement_accepts() {
        // First execution: high tracking error (0.8)
        // After transformation: lower tracking error (0.3) → Accept
        let trace_high = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };
        let trace_low = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.3,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_high), Ok(trace_low)]);
        let segment = make_move_l();
        let operator = MockOperator::new("test_improve", true, vec![segment.clone()]);

        let orch = FeedbackOrchestrator::new(Box::new(executor), vec![Box::new(operator)]);

        let program = PlanningProgram::new(vec![segment]);
        let verdict = orch.run(&program).expect("run should succeed");

        match verdict {
            Verdict::Accept {
                original_error,
                new_error,
            } => {
                assert!(
                    (original_error - 0.8).abs() < f64::EPSILON,
                    "expected original_error 0.8, got {original_error}"
                );
                assert!(
                    (new_error - 0.3).abs() < f64::EPSILON,
                    "expected new_error 0.3, got {new_error}"
                );
            }
            other => panic!("expected Accept, got {other:?}"),
        }
    }

    // ======================================================================
    // Task 3.8 RED + Task 3.9 GREEN — NoActionNeeded early return
    //
    // RED:   test written before the early-return guard existed
    // GREEN: `if findings.is_empty() { return Ok(NoActionNeeded) }` added
    // ======================================================================

    #[test]
    fn test_clean_trace_returns_no_action_needed() {
        // All segments below threshold → no findings → NoActionNeeded
        let clean_trace = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.1,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(clean_trace)]);
        // No operators needed since we never reach transformation
        let orch = FeedbackOrchestrator::new(Box::new(executor), vec![]);

        let program = PlanningProgram::new(vec![make_move_l()]);
        let verdict = orch.run(&program).expect("run should succeed");

        assert_eq!(verdict, Verdict::NoActionNeeded);
    }

    #[test]
    fn test_multi_segment_clean_trace() {
        let clean_trace = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.1,
                },
                SegmentTrace {
                    max_tracking_error: 0.2,
                },
                SegmentTrace {
                    max_tracking_error: 0.3,
                },
            ],
        };

        let executor = MockExecutor::new(vec![Ok(clean_trace)]);
        let orch = FeedbackOrchestrator::new(Box::new(executor), vec![]);

        let program = PlanningProgram::new(vec![make_move_l(), make_move_l(), make_move_l()]);
        let verdict = orch.run(&program).expect("run should succeed");

        assert_eq!(verdict, Verdict::NoActionNeeded);
    }

    // ======================================================================
    // Task 3.10 RED + Task 3.11 GREEN — Worsened metrics → Reject
    //
    // RED:   test written before comparison was wired in run()
    // GREEN: run() delegates to Verdict::from_comparison
    // ======================================================================

    #[test]
    fn test_worsened_metrics_returns_reject() {
        // First execution: error above threshold (0.8) triggers finding
        // After transformation: higher error (0.9) → Reject
        let trace_original = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };
        let trace_worse = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.9,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_original), Ok(trace_worse)]);
        let segment = make_move_l();
        let operator = MockOperator::new("test_worsen", true, vec![segment.clone()]);

        let orch = FeedbackOrchestrator::new(Box::new(executor), vec![Box::new(operator)]);

        let program = PlanningProgram::new(vec![segment]);
        let verdict = orch.run(&program).expect("run should succeed");

        match verdict {
            Verdict::Reject {
                original_error,
                new_error,
            } => {
                assert!(
                    (original_error - 0.8).abs() < f64::EPSILON,
                    "expected original_error 0.8, got {original_error}"
                );
                assert!(
                    (new_error - 0.9).abs() < f64::EPSILON,
                    "expected new_error 0.9, got {new_error}"
                );
            }
            other => panic!("expected Reject, got {other:?}"),
        }
    }

    // ======================================================================
    // Task 3.12 RED + Task 3.13 GREEN — Integration test (full cycle)
    //
    // RED:   test written before integration wiring was complete
    // GREEN: all types wired together — mod.rs updated with pub mod orchestrator
    // ======================================================================

    #[test]
    fn test_integration_full_cycle_end_to_end() {
        // Full cycle with 3 segments:
        //   - Segments 0, 2: clean
        //   - Segment 1: high tracking error (0.9) → triggers operator
        //   - After transformation: segment 1 error drops to 0.4 → Accept
        let trace_original = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.2,
                },
                SegmentTrace {
                    max_tracking_error: 0.9,
                },
                SegmentTrace {
                    max_tracking_error: 0.3,
                },
            ],
        };
        let trace_improved = TraceSnapshot {
            segments: vec![
                SegmentTrace {
                    max_tracking_error: 0.2,
                },
                SegmentTrace {
                    max_tracking_error: 0.4,
                },
                SegmentTrace {
                    max_tracking_error: 0.3,
                },
            ],
        };

        let executor = MockExecutor::new(vec![Ok(trace_original), Ok(trace_improved)]);

        let seg1 = make_move_l();
        let seg2 = make_move_l();
        let seg3 = make_move_l();

        // Operator applies to segment 1 (index 1) — the one with high error
        let replacement = make_move_l();
        let operator = MockOperator::new("test_integration", true, vec![replacement]);

        let orch = FeedbackOrchestrator::new(Box::new(executor), vec![Box::new(operator)]);

        let program = PlanningProgram::new(vec![seg1, seg2, seg3]);
        let verdict = orch.run(&program).expect("integration run should succeed");

        match verdict {
            Verdict::Accept {
                original_error,
                new_error,
            } => {
                assert!(
                    (original_error - 0.9).abs() < f64::EPSILON,
                    "expected global max 0.9, got {original_error}"
                );
                assert!(
                    (new_error - 0.4).abs() < f64::EPSILON,
                    "expected global max 0.4, got {new_error}"
                );
            }
            other => panic!("expected Accept, got {other:?}"),
        }
    }

    // ======================================================================
    // Triangulation: operator selection behavior
    // ======================================================================

    #[test]
    fn test_orchestrator_uses_first_applicable_operator() {
        // Two operators: first doesn't apply, second does → second should run
        let trace_high = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };
        let trace_low = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.3,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_high), Ok(trace_low)]);

        let segment = make_move_l();

        // Operator that does NOT apply to the finding
        let op_noop = MockOperator::new("noop", false, vec![]);
        // Operator that DOES apply and improves things
        let op_fixer = MockOperator::new("fixer", true, vec![segment.clone()]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            vec![Box::new(op_noop), Box::new(op_fixer)],
        );

        let program = PlanningProgram::new(vec![segment]);
        let verdict = orch.run(&program);

        assert!(verdict.is_ok(), "expected Ok when second operator applies");
    }

    #[test]
    fn test_orchestrator_no_applicable_operator_returns_error() {
        // Finding exists but no operator applies → error
        let trace_bad = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_bad)]);
        let operator = MockOperator::new("never_applies", false, vec![]);

        let orch = FeedbackOrchestrator::new(Box::new(executor), vec![Box::new(operator)]);

        let program = PlanningProgram::new(vec![make_move_l()]);
        let result = orch.run(&program);

        assert!(result.is_err(), "expected error when no operator applies");
        match result.unwrap_err() {
            FeedbackError::ExecutionFailed(msg) => {
                assert!(
                    msg.contains("no applicable operator"),
                    "expected 'no applicable operator' message, got: {msg}"
                );
            }
        }
    }
}
