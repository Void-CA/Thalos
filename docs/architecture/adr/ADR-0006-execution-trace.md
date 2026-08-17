# ADR-0006: Execution Trace

## Status

Proposed

## Context

Thalos registra ejecuciones mediante `MotionTrace`, un tipo que captura muestras cronológicas de posiciones articulares. Con la introducción del sistema experto (M5) y la necesidad de comparar ejecuciones reales contra planes, `MotionTrace` se queda corto en dos aspectos:

1. **No captura estado cartesiano**: solo posiciones articulares, sin TCP pose, velocidades cartesianas, ni tracking error.
2. **No tiene semántica de dominio**: es una colección plana de samples sin metadatos de ejecución (backend usado, plan asociado, eventos).

Además, el `MotionRecorder` está acoplado al `SceneService` en `thalos-runtime`. Necesitamos un modelo de telemetía que:

- Sea el artifact central de ejecución (como `ProblemRegions` lo es para evaluación).
- Capture estado completo: articular + cartesiano + errores.
- Tenga metadatos de ejecución (plan, backend, duración, eventos).
- Sea serializable para persistencia y exportación.
- Pueda alimentar análisis comparativos (plan vs trace).

## Decision

Introducir `ExecutionTrace` como el modelo de dominio para telemetía de ejecución, reemplazando el uso directo de `MotionTrace` como artifact principal.

### Modelo de datos

```rust
/// Traza completa de una ejecución — el artifact central de observabilidad.
pub struct ExecutionTrace {
    /// Metadatos de la ejecución.
    pub metadata: TraceMetadata,
    /// Muestras cronológicas ordenadas por timestamp.
    pub samples: Vec<ExecutionSample>,
    /// Eventos de ciclo de vida durante la ejecución.
    pub events: Vec<ExecutionEvent>,
}

/// Metadatos de la ejecución.
pub struct TraceMetadata {
    /// ID de la sesión asociada.
    pub session_id: String,
    /// ID del plan ejecutado.
    pub plan_id: String,
    /// Backend utilizado.
    pub source: ExecutionSource,
    /// Robot utilizado.
    pub robot_name: String,
    /// Cantidad de articulaciones.
    pub joint_count: usize,
    /// Duración total.
    pub duration: Duration,
    /// Frecuencia de muestreo (samples/segundo).
    pub sample_rate: f64,
}

/// Una muestra del estado del robot en un instante.
pub struct ExecutionSample {
    /// Tiempo desde el inicio de la ejecución.
    pub timestamp: Duration,
    /// Posiciones articulares (rad).
    pub joints: Vec<f64>,
    /// Velocidades articulares (rad/s).
    pub velocities: Vec<f64>,
    /// Aceleraciones articulares (rad/s²), derivadas numéricamente.
    pub accelerations: Vec<f64>,
    /// Posición cartesiana del TCP: [x, y, z, qw, qx, qy, qz].
    pub tcp_pose: [f64; 7],
    /// Velocidad cartesiana del TCP: [vx, vy, vz, ωx, ωy, ωz].
    pub tcp_velocity: [f64; 6],
    /// Error de tracking (diferencia entre posición actual y objetivo).
    pub tracking_error: Option<f64>,
    /// Progreso de la trayectoria (0.0 a 1.0).
    pub progress: f64,
}

/// Evento de ciclo de vida durante la ejecución.
pub enum ExecutionEvent {
    Started { timestamp: Duration },
    Paused { timestamp: Duration },
    Resumed { timestamp: Duration },
    WaypointReached { timestamp: Duration, waypoint: usize },
    SegmentCompleted { timestamp: Duration, segment: usize },
    Error { timestamp: Duration, message: String },
    Completed { timestamp: Duration },
    Cancelled { timestamp: Duration },
}
```

### Ubicación

El módulo de telemetía vivirá en `thalos-runtime/src/telemetry/`:

```
thalos-runtime/src/telemetry/
├── mod.rs          → re-exports
├── trace.rs        → ExecutionTrace + ExecutionSample
├── metadata.rs     → TraceMetadata
├── event.rs        → ExecutionEvent
└── recorder.rs     → ExecutionRecorder
```

### Relación con MotionTrace

`MotionTrace` no se elimina — sigue siendo útil para el pipeline de replay (que opera sobre posiciones articulares). `ExecutionTrace` lo envuelve y extiende:

- `ExecutionTrace` puede construirse desde `MotionTrace` + metadatos.
- `MotionTrace` puede extraerse de `ExecutionTrace` para replay.
- El `SessionManager` migrará a almacenar `ExecutionTrace` como artifact principal.

### Serialización

`ExecutionTrace` implementa `Serialize`/`Deserialize` para persistencia como JSON en
`~/.thalos/sessions/{id}/execution_trace.json`.

## Rationale

### ¿Por qué no extender MotionTrace?

`MotionTrace` tiene un propósito específico: ser el input del `ReplayBackend`. Agregarle pose cartesiana, eventos y metadatos rompería su simplicidad y acoplaría replay con observabilidad. Son dos responsabilidades distintas.

### ¿Por qué en thalos-runtime y no en thalos-core?

El trace depende de `ExecutionSource` y del modelo de sesiones, que viven en `thalos-runtime`. No es un tipo de dominio puro (como `Trajectory`), sino un artifact de ejecución.

### Eventos como enum, no strings

Los eventos tipados permiten:
- Filtrado por tipo en frontend.
- Cómputo de estadísticas (tiempo en pausa, tiempo entre waypoints).
- Disparar comportamientos específicos en el sistema experto.

## Consequences

1. `MotionRecorder` será reemplazado por `ExecutionRecorder` en el pipeline de ejecución.
2. `MotionTrace` se mantiene para compatibilidad con `ReplayBackend`.
3. El `SessionManager` almacenará `ExecutionTrace` en vez de `MotionTrace`.
4. Los gráficos de M6 consumirán `ExecutionTrace` directamente.
5. El sistema experto (M7+) podrá comparar `ExecutionTrace` contra planes.

## Alternatives Considered

### Extender MotionTrace

Descartado por mezcla de responsabilidades.

### Tipo separado en thalos-core

Descartado por dependencia de `ExecutionSource` (vive en runtime).

### gRPC/protobuf para telemetía

Innecesario para el MVP. JSON es suficiente. La estructura actual permite migrar a un formato binario si el rendimiento lo requiere.
