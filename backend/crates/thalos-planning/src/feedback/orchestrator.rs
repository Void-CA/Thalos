//! Feedback loop orchestrator — coordinates the full planning feedback cycle.
//!
//! This is the coordination layer of the feedback loop (PR 4d rewrite). It
//! receives four collaborating components and never implements their logic:
//!
//! - A [`PlanExecutor`] — executes [`PlanningProgram`]s and returns traces.
//! - An [`Analyzer`](thalos_core::analysis::analyzer::Analyzer) — the
//!   new-model "analyze" step: trace → [`Observation`]s.
//! - A registry of [`ObservationIntentionOperator`]s — the "propose" step.
//! - A [`ProposalMaterializer`] — the "materialize" step: proposal → segments.
//!
//! ## Cycle (entirely in new-model terms, PR 4d)
//!
//! ```text
//! Execution → analyze → Observation
//!                      → propose → ActionProposal
//!                                  → materialize → MotionSegment
//!                                                  → apply → re-execute → Verdict
//! ```
//!
//! 1. Execute original program.
//! 2. Analyze trace → [`Observation`]s (delegated to the analyzer).
//! 3. If no observations → [`Verdict::NoActionNeeded`].
//! 4. Propose: first-applicable operator → [`ActionProposal`]s (delegated).
//! 5. Materialize: resolve the target segment and translate the proposal into
//!    replacement segments (delegated to the materializer).
//! 6. Apply: build the modified program with substituted segments.
//! 7. Re-execute the modified program.
//! 8. Compare: [`Verdict::from_comparison`].
//!
//! ## Constraints (C2 — the orchestrator owns no domain rules)
//!
//! - No concrete operator or materializer imports — components arrive via
//!   `Box<dyn ...>`.
//! - First-applicable operator wins — no ranking, no scoring.
//! - The orchestrator NEVER matches on `ObservationKind` (phenomena), never
//!   reads thresholds or severity, and never decides remediation HOW — the
//!   operator and the materializer own those rules.
//! - Plan addressing (observation → segment index) is mechanical coordination:
//!   the feedback vocabulary anchors a segment via `Location::Waypoint(idx)`
//!   or `attributes["segment_id"]`.
//! - Comparison math lives in `Verdict` — the orchestrator never implements it.
//! - The temporal execution-finding adapter (PR 4c) was removed in the
//!   phase-6 deletion (PR 6, tasks.md 6.1) — this path never used it: the
//!   analyzer produces observations directly (C3).
//! - [`FeedbackError`] is kept minimal (single variant for v1).

use thalos_core::analysis::analyzer::Analyzer;
use thalos_core::analysis::attribute_value::AttributeValue;
use thalos_core::analysis::location::Location;
use thalos_core::analysis::observation::Observation;
use thalos_core::motion::segment::MotionSegment;

use crate::feedback::finding::TraceSnapshot;
use crate::feedback::materializer::ProposalMaterializer;
use crate::feedback::operator::ObservationIntentionOperator;
use crate::motion::program::PlanningProgram;

// ============================================================================
// Verdict
// ============================================================================

/// Result of comparing execution quality before and after transformation.
///
/// The comparison logic lives here — consumers (including the orchestrator)
/// call [`Verdict::from_comparison`] and never implement comparison math.
///
/// ## New-model mapping (PR 4d)
///
/// The improved/worsened semantics are preserved: a remediation is accepted
/// only when the re-executed program actually improves the global max tracking
/// error. The new-model concepts feed the cycle upstream — the observation's
/// `severity` and the proposal's `priority`/`impact` express the *expected*
/// remediation weight (computed by the operator); the verdict measures the
/// *actual* execution-quality delta.
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

/// Records the result of materializing a proposal onto a segment.
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
    /// The replacement segments produced by the materializer.
    pub replacement_segments: Vec<MotionSegment>,
}

// ============================================================================
// FeedbackError
// ============================================================================

/// Errors that can occur during the feedback cycle.
///
/// Kept minimal for v1 — only `ExecutionFailed` exists. New variants can
/// be added as the feedback loop gains capability (e.g. analyzer errors,
/// configuration errors).
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

/// Selects the first [`ObservationIntentionOperator`] whose `applies_to()`
/// returns `true`.
///
/// Returns `None` when no operator is applicable. Operators are iterated in
/// registration order — the order has no algorithmic meaning (no ranking).
fn select_operator<'a>(
    operators: &'a [Box<dyn ObservationIntentionOperator>],
    observation: &Observation,
) -> Option<&'a dyn ObservationIntentionOperator> {
    operators
        .iter()
        .find(|op| op.applies_to(observation))
        .map(|op| op.as_ref())
}

/// Resolves the plan segment index an observation addresses.
///
/// The feedback vocabulary anchors a phenomenon to its segment position via
/// `Location::Waypoint(idx)` (the PR 4c adapter contract) or
/// `attributes["segment_id"]` (typed integer). This is mechanical plan
/// addressing — coordination, not a phenomenon rule (C2).
fn segment_index(observation: &Observation) -> Option<usize> {
    match observation.location {
        Location::Waypoint(idx) => Some(idx),
        _ => match observation.attributes.get("segment_id") {
            Some(AttributeValue::Integer(idx)) if *idx >= 0 => Some(*idx as usize),
            _ => None,
        },
    }
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
/// Holds an executor, an analyzer, an operator registry and a materializer.
/// The [`run()`](FeedbackOrchestrator::run) method orchestrates the cycle but
/// never implements analysis, transformation, materialization, or comparison
/// logic (C2).
pub struct FeedbackOrchestrator {
    /// Abstracts compilation and execution (decouples from `thalos-runtime`).
    executor: Box<dyn PlanExecutor>,
    /// New-model analyze step: execution trace → observations.
    analyzer: Box<dyn Analyzer<TraceSnapshot> + Send + Sync>,
    /// Operator registry — receives at construction, never instantiates.
    operators: Vec<Box<dyn ObservationIntentionOperator>>,
    /// Proposal → plan modification step.
    materializer: Box<dyn ProposalMaterializer>,
}

impl FeedbackOrchestrator {
    /// Creates a new orchestrator with the given collaborating components.
    ///
    /// The operator registry is ordered but the order has no algorithmic
    /// meaning — only first-applicable selection is used.
    pub fn new(
        executor: Box<dyn PlanExecutor>,
        analyzer: Box<dyn Analyzer<TraceSnapshot> + Send + Sync>,
        operators: Vec<Box<dyn ObservationIntentionOperator>>,
        materializer: Box<dyn ProposalMaterializer>,
    ) -> Self {
        Self {
            executor,
            analyzer,
            operators,
            materializer,
        }
    }

    /// Runs the full feedback cycle on a motion program.
    ///
    /// ## Steps
    ///
    /// 1. Execute the original program.
    /// 2. Analyze the trace → observations (delegated).
    /// 3. If no observations → return [`Verdict::NoActionNeeded`] early.
    /// 4. Propose: first-applicable operator → proposals (delegated).
    /// 5. Materialize: resolve the target segment and translate the proposal
    ///    into replacement segments (delegated).
    /// 6. Build a modified `PlanningProgram` with substituted segments.
    /// 7. Re-execute the modified program.
    /// 8. Compare original vs new trace → return [`Verdict`] (delegated).
    pub fn run(&self, program: &PlanningProgram) -> Result<Verdict, FeedbackError> {
        // 1. Execute original program
        let original_trace = self.executor.execute_program(program)?;

        // 2. Analyze trace → observations (new-model analyze step)
        let observations = self.analyzer.analyze(&original_trace);

        // 3. Early return when no observations (clean trace → NoActionNeeded)
        if observations.is_empty() {
            return Ok(Verdict::NoActionNeeded);
        }

        // Take the first observation (v1 operates on one per cycle, mirroring
        // the legacy first-finding rule).
        let observation = &observations[0];

        // 4. Propose: first-applicable observation operator (no ranking)
        let operator = select_operator(&self.operators, observation).ok_or_else(|| {
            FeedbackError::ExecutionFailed("no applicable operator for observation".to_string())
        })?;
        let proposals = operator.apply(observation);
        let proposal = proposals.first().ok_or_else(|| {
            FeedbackError::ExecutionFailed("operator produced no proposal".to_string())
        })?;

        // 5. Materialize: resolve the target segment and translate the
        //    proposal into replacement segments.
        let segment_id = segment_index(observation).ok_or_else(|| {
            FeedbackError::ExecutionFailed(
                "observation carries no plan segment address".to_string(),
            )
        })?;
        let target = program.segments.get(segment_id).ok_or_else(|| {
            FeedbackError::ExecutionFailed(format!("segment index {segment_id} out of bounds"))
        })?;
        let replacement_segments = self
            .materializer
            .materialize(proposal, target)
            .map_err(|e| FeedbackError::ExecutionFailed(e.to_string()))?;

        let candidate = TransformationCandidate {
            operator_name: operator.name(),
            segment_id,
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

    use std::collections::BTreeMap;
    use std::sync::Mutex;

    use thalos_core::analysis::action::{ActionImpact, ActionKind, ActionPriority};
    use thalos_core::analysis::analyzer::Analyzer;
    use thalos_core::analysis::attribute_value::AttributeValue;
    use thalos_core::analysis::location::Location;
    use thalos_core::analysis::observation::{
        ArtifactRef, Observation, ObservationId, ObservationKind, Severity,
    };
    use thalos_core::ids::{ExecutionSessionId, OperationId};
    use thalos_core::motion::segment::MotionSegment;
    use thalos_core::prelude::{FrameId, Pose, Transform3D};

    use crate::feedback::finding::SegmentTrace;
    use crate::feedback::materializer::{MaterializationError, ProposalMaterializer};
    use crate::feedback::operator::{ActionProposal, ObservationIntentionOperator};

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

    /// Mock analyzer (new-model analyze step): returns configurable
    /// observations for any trace.
    struct MockAnalyzer {
        observations: Vec<Observation>,
    }

    impl MockAnalyzer {
        fn new(observations: Vec<Observation>) -> Self {
            Self { observations }
        }
    }

    impl Analyzer<TraceSnapshot> for MockAnalyzer {
        fn analyze(&self, _trace: &TraceSnapshot) -> Vec<Observation> {
            self.observations.clone()
        }
    }

    /// Mock operator over the NEW observation model.
    struct MockOperator {
        name: &'static str,
        applies: bool,
        proposals: Vec<ActionProposal>,
    }

    impl MockOperator {
        fn new(name: &'static str, applies: bool, proposals: Vec<ActionProposal>) -> Self {
            Self {
                name,
                applies,
                proposals,
            }
        }
    }

    impl ObservationIntentionOperator for MockOperator {
        fn name(&self) -> &'static str {
            self.name
        }

        fn applies_to(&self, _observation: &Observation) -> bool {
            self.applies
        }

        fn apply(&self, _observation: &Observation) -> Vec<ActionProposal> {
            self.proposals.clone()
        }
    }

    /// Mock materializer: returns configurable replacements for any proposal.
    struct MockMaterializer {
        replacements: Vec<MotionSegment>,
    }

    impl MockMaterializer {
        fn new(replacements: Vec<MotionSegment>) -> Self {
            Self { replacements }
        }
    }

    impl ProposalMaterializer for MockMaterializer {
        fn name(&self) -> &'static str {
            "mock_materializer"
        }

        fn materialize(
            &self,
            _proposal: &ActionProposal,
            _target: &MotionSegment,
        ) -> Result<Vec<MotionSegment>, MaterializationError> {
            Ok(self.replacements.clone())
        }
    }

    /// Materializer that fails with `IkFailure` (error propagation test).
    struct FailingMaterializer;

    impl ProposalMaterializer for FailingMaterializer {
        fn name(&self) -> &'static str {
            "failing_materializer"
        }

        fn materialize(
            &self,
            _proposal: &ActionProposal,
            _target: &MotionSegment,
        ) -> Result<Vec<MotionSegment>, MaterializationError> {
            Err(MaterializationError::IkFailure)
        }
    }

    /// Materializer that records the target segment it received, proving the
    /// orchestrator resolved the right plan address. The recorder is shared
    /// via `Arc` so the test can inspect it after `run()` consumed the box.
    struct RecordingMaterializer {
        recorded: std::sync::Arc<Mutex<Vec<MotionSegment>>>,
    }

    impl RecordingMaterializer {
        fn new() -> Self {
            Self {
                recorded: std::sync::Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    impl ProposalMaterializer for RecordingMaterializer {
        fn name(&self) -> &'static str {
            "recording_materializer"
        }

        fn materialize(
            &self,
            _proposal: &ActionProposal,
            target: &MotionSegment,
        ) -> Result<Vec<MotionSegment>, MaterializationError> {
            self.recorded
                .lock()
                .expect("recording materializer lock")
                .push(target.clone());
            Ok(vec![target.clone()])
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

    fn make_move_l_named(origin: &str) -> MotionSegment {
        MotionSegment::MoveL {
            origin: OperationId(origin.into()),
            frame: FrameId::World,
            target_pose: Pose::new(FrameId::World, FrameId::World, Transform3D::identity()),
            max_velocity: None,
        }
    }

    /// Tracking observation anchored at a plan segment via `Location::Waypoint`
    /// — the feedback vocabulary's plan address (the adapter maps
    /// `segment_id` → Waypoint).
    fn tracking_observation_at_segment(id: u32, segment: usize) -> Observation {
        Observation {
            id: ObservationId(id),
            kind: ObservationKind::TrackingError,
            severity: Severity::Error,
            artifact: ArtifactRef::ExecutionSession(ExecutionSessionId("e1".to_string())),
            location: Location::Waypoint(segment),
            attributes: BTreeMap::new(),
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    /// Tracking observation anchored via `attributes["segment_id"]` (the
    /// adapter emits both — triangulation for plan addressing).
    fn tracking_observation_with_segment_attribute(id: u32, segment: u32) -> Observation {
        let mut attributes = BTreeMap::new();
        attributes.insert(
            "segment_id".to_string(),
            AttributeValue::Integer(segment as i64),
        );
        Observation {
            id: ObservationId(id),
            kind: ObservationKind::TrackingError,
            severity: Severity::Error,
            artifact: ArtifactRef::ExecutionSession(ExecutionSessionId("e1".to_string())),
            location: Location::Timestamp(0),
            attributes,
            causes: Vec::new(),
            related: Vec::new(),
        }
    }

    /// The proposal shape the new-model operator emits (PR 4b).
    fn switch_proposal(target: ObservationId) -> ActionProposal {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "strategy".to_string(),
            AttributeValue::Text("move_j".to_string()),
        );
        ActionProposal {
            kind: ActionKind::SwitchMoveStrategy,
            target_observation: target,
            priority: ActionPriority::Medium,
            impact: ActionImpact::Medium,
            parameters,
        }
    }

    // ======================================================================
    // Verdict comparison (approval tests — unchanged by PR 4d)
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
    // Orchestrator constructor (new pipeline: executor + analyzer + operators
    // + materializer)
    // ======================================================================

    #[test]
    fn test_orchestrator_constructor_accepts_all_four_components() {
        let executor = MockExecutor::new(vec![]);
        let analyzer = MockAnalyzer::new(vec![]);
        let operators: Vec<Box<dyn ObservationIntentionOperator>> = vec![];
        let materializer = MockMaterializer::new(vec![]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            operators,
            Box::new(materializer),
        );

        // Verify the struct compiles and is Send + Sync
        fn is_send_sync<T: Send + Sync>() {}
        is_send_sync::<FeedbackOrchestrator>();

        let _ = orch;
    }

    // ======================================================================
    // Full cycle orchestration (C2: run() coordinates, never implements)
    // ======================================================================

    #[test]
    fn test_full_cycle_with_improvement_accepts() {
        // First execution: high tracking error (0.8) → observation produced.
        // Operator proposes, materializer replaces, re-execution improves (0.3)
        // → Accept.
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
        let observation = tracking_observation_at_segment(1, 0);
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let operator =
            MockOperator::new("test_improve", true, vec![switch_proposal(observation.id)]);
        let segment = make_move_l();
        let materializer = MockMaterializer::new(vec![segment.clone()]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(materializer),
        );

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

    #[test]
    fn test_clean_trace_returns_no_action_needed() {
        // No observations → no remediation → NoActionNeeded (executor runs once).
        let clean_trace = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.1,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(clean_trace)]);
        let analyzer = MockAnalyzer::new(vec![]);
        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![],
            Box::new(MockMaterializer::new(vec![])),
        );

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
        let analyzer = MockAnalyzer::new(vec![]);
        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![],
            Box::new(MockMaterializer::new(vec![])),
        );

        let program = PlanningProgram::new(vec![make_move_l(), make_move_l(), make_move_l()]);
        let verdict = orch.run(&program).expect("run should succeed");

        assert_eq!(verdict, Verdict::NoActionNeeded);
    }

    #[test]
    fn test_worsened_metrics_returns_reject() {
        // Original error above threshold (0.8) → remediation → worse (0.9)
        // → Reject. Same pipeline, degraded outcome.
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
        let observation = tracking_observation_at_segment(1, 0);
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let operator =
            MockOperator::new("test_worsen", true, vec![switch_proposal(observation.id)]);
        let segment = make_move_l();
        let materializer = MockMaterializer::new(vec![segment.clone()]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(materializer),
        );

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

    #[test]
    fn test_integration_full_cycle_end_to_end() {
        // 3 segments; segment 1 has the problem; the replacement is spliced in
        // and the re-execution improves → Accept.
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
        let observation = tracking_observation_at_segment(1, 1);
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let operator = MockOperator::new(
            "test_integration",
            true,
            vec![switch_proposal(observation.id)],
        );
        let replacement = make_move_l();
        let materializer = MockMaterializer::new(vec![replacement]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(materializer),
        );

        let program = PlanningProgram::new(vec![make_move_l(), make_move_l(), make_move_l()]);
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
    // Operator selection (first-applicable, no ranking)
    // ======================================================================

    #[test]
    fn test_orchestrator_uses_first_applicable_operator() {
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
        let observation = tracking_observation_at_segment(1, 0);
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let segment = make_move_l();

        // Operator that does NOT apply, then one that DOES and improves.
        let op_noop = MockOperator::new("noop", false, vec![]);
        let op_fixer = MockOperator::new("fixer", true, vec![switch_proposal(observation.id)]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(op_noop), Box::new(op_fixer)],
            Box::new(MockMaterializer::new(vec![segment.clone()])),
        );

        let program = PlanningProgram::new(vec![segment]);
        let verdict = orch.run(&program);

        assert!(verdict.is_ok(), "expected Ok when second operator applies");
    }

    #[test]
    fn test_orchestrator_no_applicable_operator_returns_error() {
        // Observation exists but no operator applies → error.
        let trace_bad = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_bad)]);
        let observation = tracking_observation_at_segment(1, 0);
        let analyzer = MockAnalyzer::new(vec![observation]);
        let operator = MockOperator::new("never_applies", false, vec![]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(MockMaterializer::new(vec![])),
        );

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

    // ======================================================================
    // Orchestration error paths (new-model)
    // ======================================================================

    #[test]
    fn test_orchestrator_operator_without_proposal_returns_error() {
        // An operator that applies but produces no proposal is a degenerate
        // state — the orchestrator reports it instead of guessing.
        let trace_bad = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_bad)]);
        let observation = tracking_observation_at_segment(1, 0);
        let analyzer = MockAnalyzer::new(vec![observation]);
        let operator = MockOperator::new("empty_proposer", true, vec![]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(MockMaterializer::new(vec![])),
        );

        let program = PlanningProgram::new(vec![make_move_l()]);
        let result = orch.run(&program);

        assert!(
            result.is_err(),
            "expected error when operator yields no proposal"
        );
        match result.unwrap_err() {
            FeedbackError::ExecutionFailed(msg) => {
                assert!(
                    msg.contains("no proposal"),
                    "expected 'no proposal' message, got: {msg}"
                );
            }
        }
    }

    #[test]
    fn test_orchestrator_observation_without_segment_address_returns_error() {
        // An observation that carries no plan address (neither
        // Location::Waypoint nor attributes["segment_id"]) cannot be mapped to
        // a target segment — coordination error, reported by the orchestrator.
        let trace_bad = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_bad)]);
        let mut observation = tracking_observation_at_segment(1, 0);
        observation.location = Location::Timestamp(400);
        observation.attributes = BTreeMap::new();
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let operator = MockOperator::new("no_address", true, vec![switch_proposal(observation.id)]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(MockMaterializer::new(vec![])),
        );

        let program = PlanningProgram::new(vec![make_move_l()]);
        let result = orch.run(&program);

        assert!(
            result.is_err(),
            "expected error when the observation has no address"
        );
        match result.unwrap_err() {
            FeedbackError::ExecutionFailed(msg) => {
                assert!(
                    msg.contains("no plan segment address"),
                    "expected 'no plan segment address' message, got: {msg}"
                );
            }
        }
    }

    #[test]
    fn test_orchestrator_segment_index_out_of_bounds_returns_error() {
        // The observation addresses segment 9 but the program has 1 segment.
        let trace_bad = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_bad)]);
        let observation = tracking_observation_at_segment(1, 9);
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let operator =
            MockOperator::new("out_of_bounds", true, vec![switch_proposal(observation.id)]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(MockMaterializer::new(vec![])),
        );

        let program = PlanningProgram::new(vec![make_move_l()]);
        let result = orch.run(&program);

        assert!(
            result.is_err(),
            "expected error when the segment index is out of bounds"
        );
        match result.unwrap_err() {
            FeedbackError::ExecutionFailed(msg) => {
                assert!(
                    msg.contains("out of bounds"),
                    "expected 'out of bounds' message, got: {msg}"
                );
            }
        }
    }

    #[test]
    fn test_orchestrator_materializer_error_propagates() {
        // run() never swallows materialization failures — the error surfaces
        // as FeedbackError so the caller can react.
        let trace_bad = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.8,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_bad)]);
        let observation = tracking_observation_at_segment(1, 0);
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let operator = MockOperator::new("ik_fail", true, vec![switch_proposal(observation.id)]);

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(FailingMaterializer),
        );

        let program = PlanningProgram::new(vec![make_move_l()]);
        let result = orch.run(&program);

        assert!(result.is_err(), "expected error when materialization fails");
        match result.unwrap_err() {
            FeedbackError::ExecutionFailed(msg) => {
                assert!(
                    msg.contains("IK did not converge"),
                    "expected materialization error message, got: {msg}"
                );
            }
        }
    }

    #[test]
    fn test_orchestrator_resolves_segment_from_segment_id_attribute() {
        // Plan addressing triangulation: an observation anchored via
        // attributes["segment_id"] (Timestamp location) maps to the SAME
        // program segment as the Waypoint form.
        let trace_original = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.2,
            }],
        };
        let trace_improved = TraceSnapshot {
            segments: vec![SegmentTrace {
                max_tracking_error: 0.1,
            }],
        };

        let executor = MockExecutor::new(vec![Ok(trace_original), Ok(trace_improved)]);
        let observation = tracking_observation_with_segment_attribute(1, 2);
        let analyzer = MockAnalyzer::new(vec![observation.clone()]);
        let operator =
            MockOperator::new("attr_address", true, vec![switch_proposal(observation.id)]);
        let recording = RecordingMaterializer::new();
        let recorded = recording.recorded.clone();

        let orch = FeedbackOrchestrator::new(
            Box::new(executor),
            Box::new(analyzer),
            vec![Box::new(operator)],
            Box::new(recording),
        );

        let program = PlanningProgram::new(vec![
            make_move_l_named("seg_0"),
            make_move_l_named("seg_1"),
            make_move_l_named("seg_2"),
        ]);
        let verdict = orch.run(&program);
        assert!(verdict.is_ok(), "expected Ok, got {verdict:?}");

        // The materializer must have received segment index 2.
        let recorded = recorded.lock().expect("recording lock");
        assert_eq!(
            recorded.len(),
            1,
            "materializer must be called exactly once"
        );
        match &recorded[0] {
            MotionSegment::MoveL { origin, .. } => {
                assert_eq!(origin, &OperationId("seg_2".into()));
            }
            other => panic!("expected MoveL target, got {other:?}"),
        }
    }
}
