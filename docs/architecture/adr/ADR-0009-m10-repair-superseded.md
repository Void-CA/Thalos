# ADR-0009: M10 superseded — repair architecture replaced by OptimizationPipeline + ProgramEdit + CommandHistory

## Status

✅ Accepted (2026-08-10) — resultado de la revalidación M10 posterior a la campaña de limpieza de código muerto (Grupos 1–3, ~12k LOC eliminadas).

## Context

M10 (`openspec/changes/trajectory-optimization-pipeline/exploration.md`) propuso migrar `RepairStrategy`/`RepairPlanner` hacia `TrajectoryOperator`, conservando `RepairSession` (undo/history), `PlanDelta`, `PlanMerger` y la API `/repair/sessions/*` como la pieza "que funciona".

El plan nunca pasó de `exploration.md`: no se produjeron design, proposal ni tasks. La migración quedó a medias: tipos `#[deprecated]` marcados, pero el path vivo nunca se cableó.

Mientras tanto, la arquitectura de Thalos evolucionó y resolvió las tres responsabilidades que M10 agrupaba **por separado**:

- **Algoritmo de mejora** → `TrajectoryOperator` + `OptimizationPipeline` (vía `POST /plan/optimize`), más `PlanAdvisor` para recomendaciones.
- **Historial / undo** → `CommandHistory` (`AppliedCommand` con inverse O(1), `POST /plan/commands/undo`), owned por `SceneRuntime`.
- **Representación del cambio** → `ProgramEdit` (6 variantes, `inverse()` con roundtrip, `POST /plan/program/edit`).

Evidencia adicional:

- `PlanDelta` ya declaraba su reemplazo en su propia deprecación: "migrated to ProgramEdit (PR1)".
- "Repair" dejó de ser un concepto de primer nivel: las specs/ADRs/UI actuales no lo nombran; la web oculta explícitamente repair/optimization post-MVP (`evaluation/workspace.tsx`).
- `TrajectoryOptimizer` quedó varado: su único caller era el preview de la sesión muerta; `/plan/optimize` construye `OptimizationPipeline` directamente.

## Decision

M10 se declara **superseded**, no incompleto. No se completa: la capa legacy de repair se elimina y sus sucesores vivos quedan canónicos.

```
                    LEGACY M10 (REMOVE)
                         │
             ┌───────────┴───────────┐
             │                       │
       session/repair             replay
             │                       │
          DELETE                  DELETE
             └───────────┬───────────┘
                         ▼
                 ARQUITECTURA ACTUAL (KEEP)
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
 OptimizationPipeline CommandHistory   ProgramEdit
       │
 TrajectoryOperator
```

### Se elimina

- `RepairSession` + `RepairSessionService` + `RepairSessionStore`
- `RepairPlanner`, `PlanDelta`, `PlanMerger`, `StrategyKind`, `RepairStrategy`, `RepairStrategyAdapter`
- `TrajectoryOptimizer` (wrapper varado — `OptimizationPipeline` queda como abstracción canónica)
- API: `/repair/sessions/*`, `/plan/repair/options`, `/plan/analyze/alternatives`
- `ReplayBackend` + `playback/` + `/sessions/{id}/replay` (backend variante sin consumidores, ajeno a M10)
- UI optimization/alternatives huérfana: paneles (AlternativesPanel, OptimizationPanel, AnalysisSection) + client methods que solo ellos usan (`optimize`, `repairOptions`)

### Se conserva

- `OptimizationPipeline` + los 5 operators + `/plan/optimize` (capacidad backend)
- `TrajectoryOperator` como trait canónico de transformación
- `PlanAdvisor` + `/plan/commands/preview|apply|undo`
- `ProgramEdit` + `/plan/program/edit`
- `CommandHistory` + `ExecutionSession` + `/sessions/*`

### optimization/alternatives como capacidad futura

La idea de una UI de optimización queda en roadmap, **no** como razón para conservar código huérfano. Si se recupera, se reconstruye sobre `OptimizationPipeline`/`TrajectoryOperator`/`PlanAdvisor`/`ProgramEdit`/`CommandHistory`.

## Consequences

- El warning inventory (~75 warnings de repair deprecated) se elimina de raíz, no warning por warning.
- Desaparece la familia conceptual "repair" como subsistema: sesiones paralelas, strategies legacy, deltas legacy, planner paralelo y wrapper duplicado.
- `openspec/changes/trajectory-optimization-pipeline/exploration.md` queda como documento histórico de intención; sus restos no deben reinterpretarse como trabajo pendiente.
