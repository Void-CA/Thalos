# Thalos — Project Status

## Milestones

| # | Name | Status | Description |
|---|------|--------|-------------|
| M1 | ExecutionBackend | ✅ | Trait abstracto para simulación y hardware |
| M2 | HardwareBackend + Transport | ✅ | Transport trait, TCP/Fake, `HardwareBackend` |
| M3 | MotionTrace | ✅ | Telemetría estructurada de ejecución |
| M4 | Execution Lifecycle | ✅ | Replay, SessionManager, persistencia, seek |
| M5 | Expert Planning Assistant | ✅ | Evaluación, costo, generación de alternativas |

## Current Architecture

```
thalos-core      → Robot model, kinematics, geometry, constraints
thalos-math      → Algebra, rotations, transforms
thalos-models    → Canonical robot structures
thalos-collision → Collision detection (SAT, naive)
thalos-planning  → Motion planners, trajectories, evaluation, alternative generation
thalos-visual    → 3D scenes, validation, snapshots
thalos-runtime   → Execution, sessions, playback, simulation, recording
thalos-semantic     → Task programming model (SemanticProgram, validation, lowering)
thalos-optimization → Trajectory optimization (operators, scoring, pipeline)
thalos-document     → Task document (TaskDocument) serialization
thalos-api       → HTTP, DTOs, handlers
web              → React SPA with 3D viewer
```

## M5 — Expert Planning Assistant

The system now evaluates plans, quantifies quality via cost functions, and generates ranked alternatives:

```
Plan → Analysis → WaypointAnalysis[]
                     ↓
              PlanEvaluator → PlanScore
                     ↓
              AlternativeGenerator
                     ↓
              RankedAlternatives → API → Frontend
```

### Key concepts

- **PlanMetrics**: 6-dimension quality vector (length, manipulability, joint margin, collision risk, smoothness, orientation change)
- **CostFunction**: Weighted linear combination of metrics with explainable breakdown
- **ProblemRegions**: Decouples generator from analysis — only needs waypoint indices
- **AlternativeGenerator**: Deterministic perturbation (±δ) around problematic waypoints

### API

```
POST /plan/analyze            → Full analysis + findings + recommendations
POST /plan/analyze/alternatives → Ranked alternative plans with scores
```

## Next: M6 — Execution Analytics

Analyze actual execution traces and compare against planned trajectories.
