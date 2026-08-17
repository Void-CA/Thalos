# H6 investigation: `replanned-alternate`

## Status

**IMPLEMENTED (live pipeline mechanism; evidence pending)**. Semantic targets
now survive compilation into the active-plan snapshot, so the API
`analyze_plan` path can activate a real `ReplannedAlternate` candidate. No
fabricated metrics, `hypothesis.json`, or `evidence.json` was created.

## Scope checked

The implementation keeps the existing `thalos-intelligence` assessment,
weights, and evidence export unchanged. It adds the minimum planning/runtime
mechanism required to retain semantic motion targets and evaluate a real
third candidate when those targets are available.

## What is available

- `CandidateGenerator::generate` creates the real `Direct` and
  `AlternateElbow` `Candidate` values from a `PlanningProgram`.
- `AlternateElbow::apply` replaces exactly `ctx.target_segment` and splices
  the unchanged prefix and suffix back into the candidate program.
- `PlanCompiler::compile` can compile each generated candidate with the same
  `SegmentPlanningContext`.
- `analyze_plan_with_candidates` performs the canonical per-candidate flow:
  compile, trajectory analysis, assessment, admissibility gate, and
  `CandidateEvaluator` ranking with `ObjectiveProfile::SafetyFirst`.
- `DampedLeastSquaresSolver` exposes `IKSolver::robot()`, and the solver can
  resolve an explicit IK goal when a caller has the required semantic target
  and joint seed.
- `PlanningProgram` can retain the semantic `ExecutionInstruction` values
  aligned with its resolved motion segments.
- `replan_suffix` resolves a semantic suffix from the `AlternateElbow` endpoint
  with the existing solver and the caller's chain `FrameRegistry`, returning a
  real `PlanningProgram` suffix. It does not invent frame names.
- The runtime appends `ReplannedAlternate` and sends it through the same
  compile, trajectory analysis, assessment, admissibility, and J evaluation
  path. If semantic targets are absent, it remains a two-candidate flow.

The validation harness and the exported
`validation/evidence/6dof-elbow-swap/evidence.json` expose only serialized
trajectory data, assessments, and the two-row candidate ranking. They do not
expose a callable experiment API for inspecting the live candidate programs or
semantic suffix targets, but the API analysis path now retains and consumes
those targets internally.

## Boundary and limitation

The live operation accepts the generated `AlternateElbow` candidate and
re-resolves its suffix from the altered joint state. In particular:

1. `MotionStrategy::apply` is defined as a one-segment transformation and
   returns the original program's suffix unchanged.
2. `PlanningProgram` retains the original semantic `ExecutionInstruction`
   targets alongside resolved `MotionSegment` values, and `CompiledPlan` plus
   `ActiveMotionPlan` carry them across the live API boundary.
3. `PlanCompiler::compile` plans the supplied resolved segments sequentially;
   compiling `AlternateElbow` again therefore evaluates the same candidate
   suffix. It is not suffix reoptimization.
4. The runtime service owns the complete live pipeline; its externally
   consumed result remains the DTO/evidence ranking and does not expose the
   internal candidate programs.

The current IK resolver honors an identity TCP through the solver's configured
working frame. A non-identity `ToolFrame` offset is not representable by the
existing `IKSolver::solve(IKGoal)` contract, so suffix replanning rejects that
case explicitly rather than claiming flange/TCP equivalence.

Calling `IKSolver` directly from a new script would require inventing the
missing semantic goals, seed policy, segment boundaries, and candidate
construction. Copying or perturbing the exported trajectory would not be the
existing solver's result. Either approach would violate the experiment's
honesty rule and the requirement that all three candidates use the same
filtering and scoring path.

## Why recompiling is insufficient

The existing candidate flow is:

```text
CandidateGenerator
  -> Direct / AlternateElbow PlanningProgram
  -> PlanCompiler for each program
  -> TrajectoryAnalyzer
  -> Assessor
  -> AdmissibilityGate
  -> CandidateEvaluator
```

`PlanCompiler` does maintain the current joints while compiling segments, but
that state only affects planning of the segment types it receives. It does not
turn the already-resolved suffix into new IK goals. Therefore a second compile
of the current `AlternateElbow` program is a same-candidate re-evaluation, not
the `ReplannedAlternate` defined by H6.

## Implemented architectural boundary

The internal operation now receives the semantic suffix, the alternate endpoint
state, and the same planning context. It:

1. preserves the already-generated alternate segment;
2. seeds the resolver from that segment's endpoint;
3. re-resolves every subsequent semantic target with the existing `IKSolver`
   and the preserved target identities/profiles;
4. return a new `Candidate` whose prefix and alternate segment are unchanged
   and whose suffix is the newly resolved realization; and
5. passes `Direct`, `AlternateElbow`, and `ReplannedAlternate` through the same
   compile, analysis, assessment, admissibility, and
   `CandidateEvaluator::evaluate` call with unchanged weights and
   normalization.

The smallest safe location is the runtime/planning candidate orchestration,
not a validation script. The existing resolved-only API remains honest and does
not invent semantic targets; a live caller must preserve them through
`PlanningProgram::with_semantic_targets`.

## Verification status

- `cargo check -p thalos-planning`: passed.
- `cargo check -p thalos_runtime`: passed.
- Resolver invariant test: passed, including same Cartesian target and changed
  joint seed.
- Resolver TCP guard test: passed for the unsupported non-identity offset.
- Runtime candidate pipeline test: passed, including the generated
  `ReplannedAlternate` trace row, semantic-target preservation, Cartesian goal
  preservation, and the existing ranking path.
- API/runtime/planning compile checks: passed.
- Isolated H6 metrics/evidence: not generated yet. The candidate must not be
  forced to win, and a real scenario export remains the next validation step.

## Evidence consulted

- `validation/evidence/6dof-elbow-swap/evidence.json`
- `backend/crates/thalos-planning/src/candidate/generator.rs`
- `backend/crates/thalos-planning/src/candidate/strategies/alternate_elbow.rs`
- `backend/crates/thalos-planning/src/motion/compiler.rs`
- `backend/crates/thalos-planning/src/motion/program.rs`
- `backend/crates/thalos-core/src/kinematics/inverse/solver.rs`
- `backend/crates/thalos-core/src/kinematics/inverse/solvers/dls.rs`
- `backend/crates/thalos-runtime/src/services/plan_analysis.rs`
- `backend/crates/thalos-planning/src/candidate/admissibility.rs`
- `backend/crates/thalos-planning/src/candidate/evaluator.rs`
- `backend/crates/thalos-planning/src/candidate/objective.rs`
