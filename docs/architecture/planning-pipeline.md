# Planning Pipeline

El pipeline de planificación transforma un modelo de robot y una trayectoria en conocimiento, regiones problemáticas y reparaciones aplicables.

## Flujo

```
Robot Model
    │
    ▼
CompiledPlan (merged_trajectory + segments)
    │
    ▼
TrajectoryAnalyzer (FK, Jacobiano, singularidad, manipulabilidad, colisiones)
    │
    ▼
AnalysisReport { findings, problem_regions, health_score }
    │
    ├── PlanAdvisor → Recommendations
    │
    ▼
RegionDetector (M8.1)
    │
    ▼
Vec<ProblemRegion> { kind, severity, waypoint_range, confidence, evidence }
    │
    ▼
RepairPlanner (M8.2)
    │
    ├── StrategySelector → LiftTcp, RotateTool, SplitSegment
    │
    ▼
RepairPlan { region, candidates, recommended, recommendations }
    │
    ▼
RepairSession (M8.4)
    │
    ├── Preview → RepairPreview { delta, evaluation, continuity }
    │
    ├── Apply → PlanMerger → new revision
    │
    └── Undo → rebuild desde original_plan + history
```

## Capas

| Capa | Responsabilidad | Módulo |
|------|----------------|--------|
| **analysis/** | Detectar regiones problemáticas | `RegionDetector`, `AnalysisReport` |
| **knowledge/** | Conocimiento del robot y workspace | `PlanningKnowledge`, `MonteCarloBuilder` |
| **repair/** | Generar, evaluar y aplicar reparaciones | `RepairPlanner`, `PlanMerger`, `Strategies` |
| **motion/** | Modelo de trayectoria | `CompiledPlan`, `Trajectory` |

## Endpoints

| Método | Ruta | Propósito |
|--------|------|-----------|
| POST | `/api/v1/plan/analyze` | Analizar plan activo |
| POST | `/api/v1/plan/repair/options` | Listar reparaciones disponibles |
| POST | `/api/v1/repair/sessions` | Crear sesión de reparación |
| POST | `/api/v1/repair/sessions/{id}/preview` | Preview de estrategia |
| POST | `/api/v1/repair/sessions/{id}/apply` | Aplicar reparación |
| POST | `/api/v1/repair/sessions/{id}/undo` | Deshacer última reparación |
| DELETE | `/api/v1/repair/sessions/{id}` | Descartar sesión |
