# Changelog

## 2026-07-22 — Frontend Maturation

- **Session Browser UX**: master-detail layout, filtros por estado, búsqueda textual, comparación plan vs ejecución, export CSV, lazy loading
- **ECharts 2.1**: fundación de `shared/charts/` con tipos, theme, builders para manipulability, trace y analysis
- **ECharts 2.2**: Manipulability Timeline en Analysis Dashboard con dataZoom + click → viewport focus
- **ADR-001**: UI Component Strategy — mantener componentes propios + ECharts (rechazar PrimeNG, Spartan NG, Material)

## 2026-07-21 — M8 Repair Session

- **M8.4.0**: `RepairSession`, `AppliedRepair`, `PlanRevision`, `SessionId`
- **M8.4.1**: `RepairSessionService`, endpoints REST (`POST/DELETE /repair/sessions`, `/preview`, `/apply`, `/undo`)
- **M8.4.2**: Knowledge Workspace v3 con sesión, preview, apply, historial
- **M8.4.3**: Undo con reconstrucción desde original_plan + replay

## 2026-07-21 — M8 PlanningKnowledge

- **M8.3.0**: `PlanningKnowledge`, `RobotKnowledge`, `WorkspaceKnowledge`, `SingularityZone`
- **M8.3.1**: `StaticRobotKnowledge`, `WorkspaceKnowledgeProvider`, `PlanningKnowledgeProvider` movido a `knowledge/`
- **M8.3.2**: `MonteCarloBuilder` (sampling configurable)
- **M8.3.3**: `RegionDetector.detect_with_knowledge()` — enriquecimiento con evidencia
- **M8.3.4**: `RepairPlanner.plan_with_knowledge()` — recomendaciones basadas en conocimiento

## 2026-07-21 — M8 Repair Framework

- **M8.2.0**: Repair domain types (`StrategyKind`, `PlanDelta`, `RepairCandidate`, `RepairEvaluation`, `RepairResult`)
- **M8.2.1**: `RepairStrategy` trait, `PlanMerger` (C0 continuity), `EvaluationPipeline`
- **M8.2.2**: `LiftTcpStrategy` (Cartesian IK real)
- **M8.2.3**: `RotateToolStrategy`, `SplitSegmentStrategy`, `RepairPlanner`
- Legacy `AlternativeGenerator` eliminado (626 líneas)

## 2026-07-21 — M8 Semantic Analysis

- **M8.1**: `RegionDetector` pipeline, `AnalysisReport`, regiones semánticas en vez de findings planos
- 80 waypoints singulares → 1 región

## 2026-07-21 — M8 Domain Types

- **M8.0**: `ProblemRegion`, `RegionKind`, `RegionSeverity`, `RegionMetrics`, `PlanningKnowledgeProvider` trait

## 2026-07-22 — Motion Backend Async

- `RobotController` trait async
- `SimulationController` (migra `advance_trajectory`)
- `BackendManager` como infraestructura por encima del runtime
- `RobotState` con 6 sub-estados + `revision: u64`
- MockController + BackendManager tests (10 nuevos)

## 2026-07-22 — TCP Frame Separation

Propósito original implementado durante M8:
- `ToolFrame`, `GeometricJacobian::with_tcp()`, `FKResult::tcp_position()`
- `POST /scene/tcp`, `RuntimeSnapshot.active_tcp`
- `RepairContext.tcp_frame`, `RobotKnowledge.tcp_frame`

## Pre-M8 (anteriores)

- Motion backend async
- Workspace analysis
- Scene core types
- UI/UX revamp — design tokens
