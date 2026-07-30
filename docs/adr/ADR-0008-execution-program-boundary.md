# ADR-0008: Execution Program Boundary

## Status

Accepted

## Context

Thalos has two types both named `MotionProgram`:

- `thalos_core::motion::MotionProgram` — output of `SemanticLowering`, contains `MoveJ`, `MoveL`, `Delay`, `SetOutput`
- `thalos_planning::motion::program::MotionProgram` — input of `PlanCompiler`, contains only `MotionSegment` (MoveJ/MoveL)

They were created independently during early development and their identical name suggested they should be unified. A closer analysis reveals they respond to fundamentally different questions:

| | core::MotionProgram | planning::MotionProgram |
|---|---|---|
| **Question** | "What actions must execute?" | "What trajectories must be planned?" |
| **MoveJ target** | Cartesian pose (MotionPose) | Joint-space (Vec<f64>) |
| **Invalid for planner** | Delay, SetOutput | — |
| **Invalid for runtime** | — | No Delay/IO semantics |

The two types sit on opposite sides of a domain boundary: **execution intent** vs. **planning input**.

## Decision

### 1. Keep two types, rename them

The `thalos_core` type moves to `thalos_core::execution::ExecutionProgram` — it represents a complete program of actions to execute, including motion and runtime events.

The `thalos_planning` type stays as `thalos_planning::motion::PlanningProgram` (renamed from `MotionProgram`) — it represents only the movements that require geometric planning.

### 2. Introduce MotionResolver

A new component sits between them:

```
ExecutionProgram
       ↓
MotionResolver
       ↓
MotionResolution
    ├── PlanningProgram (Vec<MotionSegment>)
    └── RuntimeProgram (Vec<RuntimeEvent>)
```

`MotionResolver` owns the transformation:
- IK resolution: Cartesian poses → joint targets for MoveJ instructions
- Frame resolution: String frame names → typed `FrameId`
- Separation: extracts Delay/SetOutput into `RuntimeEvent` list

`MotionResolver` does NOT know about backends, firmware, protocols, or manifests. Its output is purely domain types.

### 3. Define RuntimeEvent with tracing

```rust
pub struct RuntimeEvent {
    pub operation_id: OperationId,
    pub action: RuntimeAction,
}

pub enum RuntimeAction {
    Delay(Duration),
    SetOutput { channel: OutputChannel, value: OutputValue },
}
```

`operation_id` preserves traceability back to the semantic operation for future logging, metrics, and cancellation.

### 4. PlanCompiler stays isolated

`PlanCompiler` receives `PlanningProgram` (only `Vec<MotionSegment>`). It never sees events, outputs, or execution metadata.

### 5. Runtime owns the timeline

The runtime receives:
1. `CompiledPlan` (from PlanCompiler) for the motion segments
2. `RuntimeProgram` (from MotionResolver) for the events

It interleaves them in the order defined by the original `ExecutionProgram`. The runtime does not combine or merge — it interprets a resolved sequence.

## Consequences

**Positive:**
- Each component answers one question clearly
- `MotionResolver` is a pure transformation, independently testable
- `RuntimeEvent` can grow (CameraTrigger, ForceThreshold, ToolChange) without touching the planner
- Traceability via `operation_id` from semantic operation through to execution log

**Negative:**
- One extra hop in the pipeline (negligible cost)
- Need to maintain the ordering invariant: the planner does not reorder segments, so timeline order is preserved

**Mitigations:**
- Document in MotionResolver that output order is significant
- PlanCompiler already plans segments independently and concatenates them in input order — no change needed

## ADR Metadata

- **Driver:** Domain boundary between execution intent and geometric planning
- **Deciders:** @thalos-core
- **Date:** 2026-07-29
- **Alternatives considered:**
  1. *Unify into one MotionProgram* — rejected because it forces the planner to understand Delay/SetOutput, which are not planifiable
  2. *Adapter with no renaming* — rejected because the name "MotionProgram" for both types creates persistent cognitive ambiguity
