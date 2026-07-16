# ADR-0004: Evaluation Engine

## Status

Proposed

## Context

Thalos necesita evaluar la calidad de trayectorias y configuraciones robóticas según múltiples criterios: manipulabilidad, cercanía a singularidades, distancia a obstáculos, energía consumida, etc.

Hoy existen analizadores independientes (`ManipulabilityAnalyzer`, `SingularityAnalyzer`), pero no hay un sistema unificado para:
- Combinar múltiples métricas en un solo costo
- Ponderar criterios según prioridades del usuario
- Evaluar trayectorias completas (no solo waypoints individuales)

### Casos de uso

- "Esta trayectoria tiene costo 0.8 (alto)" → necesita optimización
- "Plan A tiene costo 0.5, Plan B tiene costo 0.3" → Plan B es mejor
- "Priorizar suavidad sobre tiempo" → ajustar pesos de evaluadores
- "Energía consumida depende de la trayectoria, no de un punto" → evaluador de trayectoria

## Decision

Implementar un sistema de evaluación de costos en `thalos-core::analysis::evaluation`.

### Modelo de datos

```rust
pub trait CostEvaluator: Send + Sync {
    /// Evalúa costo de una configuración individual
    fn evaluate_state(
        &self,
        state: &RobotState,
        chain: &SerialChain,
        tcp: Option<&ToolFrame>,
    ) -> f64;

    /// Evalúa costo de una trayectoria completa
    fn evaluate_trajectory(
        &self,
        trajectory: &Trajectory,
        chain: &SerialChain,
        tcp: Option<&ToolFrame>,
    ) -> f64;
}

pub struct ManipulabilityCost {
    pub weight: f64,  // default 1.0
}

pub struct SingularityCost {
    pub weight: f64,
    pub threshold: f64,  // distancia a singularidad
}

pub struct ObstacleCost {
    pub weight: f64,
    pub safe_distance: f64,  // distancia segura
}

pub struct EnergyCost {
    pub weight: f64,
}

pub struct CompositeEvaluator {
    pub evaluators: Vec<Box<dyn CostEvaluator>>,
}

impl CostEvaluator for CompositeEvaluator {
    fn evaluate_trajectory(...) -> f64 {
        self.evaluators
            .iter()
            .map(|e| e.evaluate_trajectory(trajectory, chain, tcp))
            .sum()
    }
}
```

### Por qué "Evaluation Engine" y no "Cost Maps"

Inicialmente se propuso el nombre "Cost Maps", pero:

- `EnergyCost` depende de la trayectoria, no de una posición → no es un "mapa"
- `ObstacleCost` sí puede vivir en un mapa (posición → costo)
- "Evaluation Engine" es más general y preciso

### Integración

- `TrajectoryOptimizer` consume `CostEvaluator` como función objetivo
- `PlanComparator` usa evaluadores para comparar planes
- `Advisor` usa evaluadores para generar recomendaciones
- API: `POST /plan/evaluate` para evaluación manual

### Ejemplo de uso

```rust
let evaluator = CompositeEvaluator {
    evaluators: vec![
        Box::new(ManipulabilityCost { weight: 0.3 }),
        Box::new(SingularityCost { weight: 0.5, threshold: 0.1 }),
        Box::new(ObstacleCost { weight: 0.2, safe_distance: 0.05 }),
    ],
};

let cost = evaluator.evaluate_trajectory(&trajectory, &chain, Some(&tcp));
// cost = 0.3 * manipulability_cost + 0.5 * singularity_cost + 0.2 * obstacle_cost
```

## Consequences

### Positivas

- **Unificado**: una sola interfaz para todos los criterios de calidad
- **Componible**: `CompositeEvaluator` permite combinar evaluadores
- **Ponderable**: pesos ajustables según prioridades del usuario
- **Reutilizable**: consumido por optimizer, comparator, advisor

### Negativas

- **Complejidad**: nuevo subsistema en `thalos-core`
- **Calibración**: pesos de evaluadores requieren tuning
- **Performance**: evaluar trayectoria completa puede ser costoso

### Neutrales

- **Dependencias**: `CollisionAnalyzer` (para `ObstacleCost`)
- **Breaking changes**: ninguna (nuevo módulo)

## Alternatives Considered

### Alternativa 1: Cost Maps (mapas 3D)

Pre-computar mapas de costos en espacio cartesiano (posición → costo).

**Pros**: Consultas O(1), visualización directa  
**Cons**: No todos los costos dependen de posición (ej: energía), alto consumo de memoria

**Decisión**: Descartada. "Evaluation Engine" es más general. Mapas 3D pueden ser una optimización interna de `ObstacleCost`, no la arquitectura principal.

### Alternativa 2: Funciones de costo hardcodeadas

Implementar función de costo fija en `TrajectoryOptimizer`.

**Pros**: Más simple, menos código  
**Cons**: No extensible, no ponderable, no reutilizable

**Decisión**: Descartada. Necesitamos composabilidad y ponderación.

### Alternativa 3: Evaluadores solo en planning

Implementar evaluadores en `thalos-planning`, no en `thalos-core`.

**Pros**: Menos código en core  
**Cons**: No reutilizable por análisis, runtime, o futuros componentes

**Decisión**: Descartada. Evaluación es fundamental al dominio, no solo a planificación.

## Related

- [ADR-0003: Constraint System](ADR-0003-constraint-system.md)
- [ADR-0005: Planning Assistant](ADR-0005-planning-assistant.md)
- [Arquitectura: Planning Assistant](../intelligent-planning/architecture/planning-assistant.md)
