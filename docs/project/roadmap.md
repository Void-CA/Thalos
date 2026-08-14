# Roadmap hacia el MVP

Este documento describe las fases de implementación hacia el MVP de Thalos.
Es un plan personal, no parte de la documentación pública del proyecto.

## Filosofía

El MVP no se define por cuán sofisticado es cada componente individual, sino
por cuándo el sistema completo hace Algo Útil de punta a punta:

```
Scene → MotionPlan → Execute → Robot se mueve → Runtime actualiza → Visualización responde
```

Cada fase prioriza habilitar ese flujo por sobre optimizar piezas aisladas.

## Leyenda

- ✅ Completado
- 🔄 En progreso
- ⬜ Pendiente

---

## Fase 0 — Completado ✅

| Componente | Estado |
|-----------|--------|
| Robot Model (serial chains, joints, links, segments) | ✅ |
| Kinematics (FK, Jacobian geom/num, IK DLS/Transpose) | ✅ |
| Planning (motion planners, trajectory interpolation) | ✅ |
| Collision (NaiveCollisionChecker, SAT, sphere-box, classify) | ✅ |

Estos existen como librerías. El siguiente paso es integrarlos en un sistema.

---

## Fase 1 — Scene ⬜

**Objetivo**: Unificar robots, obstáculos, herramientas y frames en una sola
estructura manejable por el runtime.

```
Scene
├── Robots        (inicialmente 1)
├── Obstacles     (opcional Fase 1)
├── Tools         (opcional Fase 1)
└── Frames        (registro global)
```

### Tasks gruesas

- Definir `Scene` como tipo de primer orden en `thalos-core`
- Migrar `SceneService` en `thalos-runtime` a usar el nuevo tipo
- Soportar agregar/remover robots, obstáculos, tools
- Extender la API REST para Scene CRUD
- Actualizar `VisualScene` para reflejar la estructura de Scene
- Frontend: view de Scene con robot + obstáculos + tools

### Criterio de éxito

POST `/scene` con un robot → GET `/scene` devuelve el estado completo →
VisualScene se renderiza en frontend.

---

## Fase 2 — Execution ⬜

**Objetivo**: Ejecutar motion plans sobre el Scene y producir resultados
observables.

```
ExecuteTrajectory
ExecuteMotionPlan
ExecutionState     (Idle, Running, Paused, Completed, Failed)
ExecutionResult    (success, collisions, metrics)
```

### Tasks gruesas

- Definir `ExecutionState` y `ExecutionResult` en `thalos-core`
- Crear `ExecutionService` en `thalos-runtime`
- Pipeline: Scene → Plan → Execute → Result
- Exponer vía API REST (POST `/execute`, GET `/execute/state`)
- Frontend: botón "Execute", indicador de estado, resultado

### Criterio de éxito

Scene con robot → planificar trayectoria → ejecutar → runtime refleja
cambio de estado → visualización se actualiza.

---

## Fase 3 — Events ⬜

**Objetivo**: El runtime notifica cambios en lugar de obligar a polling.

```
RuntimeEvent
├── MotionStarted
├── MotionCompleted
├── MotionFailed
├── CollisionDetected
├── ToolAttached
└── ...
```

### Tasks gruesas

- Definir `RuntimeEvent` enum en `thalos-core`
- Integrar emisión de eventos en `ExecutionService`
- Backend: SSE endpoint (`GET /events`) o WebSocket
- Frontend: suscripción a eventos, reacción en UI

### Criterio de éxito

Ejecutar motion plan → evento `MotionCompleted` llega al frontend →
UI reacciona sin polling.

---

## Fase 4 — Controllers ⬜

**Objetivo**: Abstraer la interfaz de control para soportar simulación y
futuros brazos reales.

```
Controller trait
├── SimulationController   (Fase 4)
├── ABB Controller         (futuro)
├── UR Controller          (futuro)
└── Fanuc Controller       (futuro)
```

### Tasks gruesas

- Definir `Controller` trait en `thalos-core`
- Implementar `SimulationController` que ejecuta sobre el modelo cinemático
- Integrar Controller con Execution pipeline
- API: seleccionar controller al crear Scene

### Criterio de éxito

Scene con robot → SimulationController → ExecuteMotionPlan → el robot
"simulado" ejecuta la trayectoria en el visualizador.

---

## Definición de MVP

Thalos alcanza el MVP cuando:

```
Usuario carga un robot →
  Ve el modelo en 3D →
    Planifica una trayectoria →
      La ejecuta →
        El robot simulado se mueve →
          La UI refleja el estado →
            Todo sin salir del frontend
```

Eso implica completar Fase 1 + Fase 2 + Fase 4 (SimulationController).
Fase 3 (Events) y los controllers de brazos reales son post-MVP.

---

## Visualización del plan

```
Fase 0 ──> Fase 1 ──> Fase 2 ──> Fase 4 ──> MVP
                      └──> Fase 3 (post-MVP)
```

Fase 0 → 1: Integrar lo existente.
Fase 1 → 2: Cerrar el loop ejecución.
Fase 2 → 4: Controller simulation.
Fase 3: Events puede empezar en paralelo con Fase 4 pero no bloquea el MVP.
