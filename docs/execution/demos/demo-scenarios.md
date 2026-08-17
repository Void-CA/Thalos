# Demo Scenarios — The Demonstratable Use-Case Library

> **Purpose**: a structured library of reproducible scenarios demonstrating the
> intelligent-motion capabilities of the Thalos planning system. Each scenario
> carries an **invariant contract** — categories and relative comparisons,
> NEVER exact numbers — and runs the REAL pipeline (generate → compile →
> analyze → assess → gate → rank) with real components, no mocks.
>
> The same `DemoScenario` representation (`backend/crates/thalos-planning/tests/demo_scenarios/`)
> feeds the integration tests today and the UI loader later (a TS mirror in the
> web app): identical behavior, same invariants, no demo-specific runtime
> knowledge.

## How a Scenario Is Verified

Every scenario runs the full candidate pipeline on real Scara geometry:

```text
CandidateGenerator::generate → per candidate (PlanCompiler → TrajectoryAnalyzer
→ DefaultAggregator → Assessor::assess) → runtime adapter mapping (ADR-5) →
AdmissibilityGate → CandidateEvaluator (SafetyFirst) → CandidateRanking
```

The test asserts the **invariant contract** rows only. Evidence numbers appear
below as **evidence (reference only, not asserted)** — a recalibration that
shifts them by epsilon must NOT break the suite; only a violated invariant may.

Pipeline-completion guard: a scenario that fails an internal stage (generate /
compile / analyze / assess / gate / rank) FAILS with the stage error. It never
silently degrades into a categorical result — a broken pipeline can never look
like a valid "no better alternative" outcome.

## The Representation (Consumer-Agnostic)

`DemoScenario { id, name, description, robot, task, home, target_segment,
expected_behavior, demonstrates }` — `expected_behavior` is categorical only:

- `direct_risk_category`: `Low` (< 0.25) / `Medium` (< 0.5) / `High` (≥ 0.5)
- `alternative_exists`: at least one alternative that is **Generated AND
  Admissible AND strictly better** than Direct (never merely "generated")
- `selected_strategy`: `Direct | InsertWaypoint | AlternateElbow`
- `strategy_outcomes`: the categorical state SET —
  `Generated | Admissible | Rejected | Skipped | Selected` (no metrics, no
  reason text in the contract)
- `endpoints_preserved`, `task_preserved`: booleans

**No `f64` fields.** The concrete skip/reject reasons (e.g. `UnsupportedSegment`,
`InvariantViolation`) are DIAGNOSTIC — documented below as evidence, never
asserted, so a refactor that renames a reason cannot break the suite.

---

## 1. `crossing-pick-place-home` — counterfactual reasoning

| | |
|---|---|
| **id** | `crossing-pick-place-home` |
| **demonstrates** | `counterfactual-reasoning` |
| **Program** | `[MoveJ home (0.0, -1.31, -0.1, 0.0) → MoveJ cross (0.5, 0.6, -0.15, 0.0) → MoveJ goal (0.5, -1.31, -0.15, 0.0)]`, `target_segment = 1` |
| **Narrative** | The middle segment's joint-space straight line crosses full extension (q2 → 0) — a localized singularity. The system evaluates Direct, synthesizes a same-side-elbow realization of the same task, and selects it. |

### Invariant contract

| Invariant | Assertion |
|-----------|-----------|
| Direct risk | `seed_risk > 0.5` (High) |
| Alternative exists | ≥ 1 admissible non-Direct with `risk < seed_risk` |
| Selected | ≠ Direct, `J_selected ≤ J_direct` |
| Singularities | `singular_selected < singular_direct` |
| Endpoints | `|q_cand − q_seed| ≤ ε` per joint |
| Task | compacted `(kind, origin)` identical |

### Evidence (reference only, not asserted)

```text
strategy               risk  quality  singular  dur(s)   manip    cost  status
Direct               0.5571  0.4429    2        7.818   0.4585   1.0000 admissible
AlternateElbow       0.1625  0.8375    0        5.256   0.6314   0.0000 admissible
SELECTED: AlternateElbow — risk 0.1625 vs 0.5571 | endpoints/task preserved | reason derived
```

Diagnostic (not asserted): Direct carries `Singularity`/`NearSingularity`
observations from the real analyzer (2 singular, 24 near-singular waypoints);
the selected realization has 0.

---

## 2. `healthy-pick-place-home` — selectivity

| | |
|---|---|
| **id** | `healthy-pick-place-home` |
| **demonstrates** | `selectivity` |
| **Program** | `[MoveJ home (0.0, -1.31, -0.1, 0.0) → MoveJ shift (0.2, -1.31, -0.1, 0.0) → MoveJ goal (0.0, -1.31, -0.1, 0.0)]`, `target_segment = 1` |
| **Narrative** | Small joint movements in a well-conditioned region (a radial out-and-back at constant q2). Direct is already the best — the system does NOT invent an alternative. |

### Invariant contract

| Invariant | Assertion |
|-----------|-----------|
| Direct risk | `seed_risk < 0.25` (Low) |
| No better alternative | no admissible with `risk < seed_risk` |
| Selected | = Direct |

### Geometry verification note (design open question — resolved)

The design's PROPOSED geometry (`[0.05, -1.25, -0.1, 0.0]`) was run through the
real pipeline BEFORE freezing the fixture: Direct assessed Low (0.1470) and no
alternative was strictly better, BUT the evaluator selected `AlternateElbow`.
In a well-conditioned region the same-side elbow re-solve is degenerate (joint
drift ~1e-6, identical risk), and its sub-epsilon path-length perturbation won
the min-max J tie-break. The contract row "Selected = Direct" did not hold, so
the fixture was changed (never the contract) and the geometry above was
verified: Direct is selected with J 0.45 vs the alternate's 0.55.

### Evidence (reference only, not asserted)

```text
strategy               risk  quality  singular  dur(s)   manip    cost  status
Direct               0.1470  0.8530    0        2.530   0.7729   0.4500 admissible
AlternateElbow       0.1470  0.8530    0        2.530   0.7729   0.5500 admissible
SELECTED: Direct — risk 0.1470 vs 0.1470 | endpoints/task preserved | reason derived
```

Diagnostic (not asserted): the alternate is admissible but NOT strictly better
(equal risk 0.1470) — the spec's `admissible > 0` with `better == 0` situation,
which MUST resolve `alternative_exists = false`. `InsertWaypoint` skips
(`UnsupportedSegment` — joint-space target). The selection is a degenerate-tie
decision; the contract rows above are the semantics it must keep.

---

## 3. `single-segment-crossing` — boundedness / honesty

| | |
|---|---|
| **id** | `single-segment-crossing` |
| **demonstrates** | `boundedness` |
| **Program** | `[MoveJ cross (0.5, 0.6, -0.15, 0.0)]`, `target_segment = 0` |
| **Narrative** | A single-segment program: no alternative strategy can meaningfully operate on it. The generator is honest — it says "skipped", not "invented" — and Direct is kept. |

### Invariant contract

| Invariant | Assertion |
|-----------|-----------|
| No eligible segment | no applicable alternative strategy (observable: only Direct is generated) |
| Strategies Skipped | both `InsertWaypoint` and `AlternateElbow` → `Skipped` (category only) |
| Selected | = Direct |

### Evidence (reference only, not asserted)

```text
strategy               risk  quality  singular  dur(s)   manip    cost  status
Direct               0.5567  0.4433    1        3.909   0.4580   0.5000 admissible
SELECTED: Direct — risk 0.5567 vs 0.5567 | endpoints/task preserved | reason derived
```

Diagnostic (not asserted): the concrete skip reasons are
`InsertWaypoint → Skipped(UnsupportedSegment)` (the materializer only splits
Cartesian `MoveL` targets) and `AlternateElbow → Skipped(InvariantViolation:
"no joint configuration precedes target segment 0 — cannot re-solve the
elbow")`. The Direct risk category (High, descriptive only — the spec table
carries no Direct-risk row) is observed, not part of the contract.

---

## 4. `collision-near-object` — EXCLUDED

The optional fourth scenario (clearance-dominated assessment) is **EXCLUDED**
from this library. The three mandatory scenarios already form the demo
narrative — repair when appropriate / no intervention when appropriate /
bounded behavior when unsupported — and a fourth fixture is not added merely
to increase the count. It MAY be added later only if a stable, low-cost
real-geometry scenario is found (spec Requirement "Optional
collision-near-object").

---

## Pipeline-Completion Guard (honesty)

A scenario whose seed cannot compile (e.g. joint targets outside the Scara's
limits) MUST fail the scenario with the stage error. The suite's guard test
exercises this with `[MoveJ op-broken [99, 99, 99, 99]]`; the propagated error
is a real planner rejection — evidence (reference only, not asserted):

```text
segment 1 failed: Joint limit violation at joint 0: value 99 ∉ [-2.443460952792061, 2.443460952792061]
```

## Running the Suite

```bash
cargo test -p thalos-planning --test demo_scenarios_test -- --nocapture   # the three scenarios + guard
cargo test -p thalos-planning                                             # whole crate
cargo test --workspace                                                    # everything
```

The ranked tables above are printed by the tests with `--nocapture`.
