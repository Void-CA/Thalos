# ADR-0003: Constraint System

## Status

Proposed

## Context

Thalos necesita un sistema de restricciones para validar configuraciones robóticas y trayectorias. Hoy no hay manera de expresar restricciones de seguridad o calidad más allá de los límites articulares. Un plan puede ser cinemáticamente válido pero inseguro.

### Casos de uso

- "El codo no puede estar por debajo de la mesa"
- "La orientación del TCP debe estar dentro de ±30° del eje Z"
- "El joint 3 no puede superar 90° si el joint 5 está en posición de singularidad"
- "El robot no puede entrar en esta zona cartesian"

### Requisitos

1. Validación binaria (satisfecho/no satisfecho) para Fase 1
2. Producción de costo (penalty) para Fase 3
3. Composición de restricciones (AND lógico)
4. Extensibilidad (nuevos tipos de constraints sin modificar evaluador)

## Decision

Implementar un sistema de restricciones simbólicas en `thalos-core::analysis::constraints`.

### Modelo de datos

```rust
pub enum Constraint {
    JointLimit { 
        joint: usize, 
        min: f64, 
        max: f64 
    },
    OrientationCone { 
        frame: FrameId, 
        axis: Vector3, 
        half_angle: f64 
    },
    CartesianBox { 
        frame: FrameId, 
        min: Vector3, 
        max: Vector3 
    },
    Composite(Vec<Constraint>),  // AND lógico
}

pub struct ConstraintResult {
    pub satisfied: bool,
    pub penalty: f64,  // 0.0 si satisfied, > 0.0 si violado
}

pub trait ConstraintEvaluator {
    fn evaluate(
        &self, 
        constraint: &Constraint,
        state: &RobotState, 
        chain: &SerialChain, 
        tcp: Option<&ToolFrame>
    ) -> ConstraintResult;
}
```

### Evolución en dos etapas

**Fase 1 (Comprender)**: Validación binaria
- `ConstraintEvaluator::check() -> Result<(), ConstraintViolation>`
- Solo responde satisfecho/no satisfecho
- Suficiente para validación de planes

**Fase 3 (Restringir)**: Validación con costos
- `ConstraintEvaluator::evaluate() -> ConstraintResult`
- Produce `penalty` cuantificada
- Habilita optimización con restricciones suaves

### Integración

- `GoalResolver` valida constraints antes de planificar
- `PlanCompiler` valida cada segmento contra constraints activos
- `TrajectoryOptimizer` suma penalties como función de costo
- `PlanComparator` usa penalties para ranking

## Consequences

### Positivas

- **Reutilizable**: sirve para planificación, validación, simulación, seguridad
- **Extensible**: nuevos tipos de constraints sin modificar evaluador
- **Componibles**: `Composite` permite AND lógico de restricciones
- **Fundamental**: se convierte en componente base del dominio

### Negativas

- **Complejidad**: nuevo subsistema en `thalos-core`
- **Performance**: evaluar constraints agrega overhead a planificación
- **Mantenimiento**: más código que mantener

### Neutrales

- **Dependencias**: ninguna (puro Rust)
- **Breaking changes**: ninguna (nuevo módulo)

## Alternatives Considered

### Alternativa 1: Constraints solo en planning

Implementar constraints solo en `thalos-planning`, no en `thalos-core`.

**Pros**: Menos código, más localizado  
**Cons**: No reutilizable por runtime, análisis, o futuros componentes

**Decisión**: Descartada. Los constraints son fundamentales al dominio, no solo a planificación.

### Alternativa 2: Constraints como funciones closures

Usar `Box<dyn Fn(&RobotState) -> bool>` en vez de enum.

**Pros**: Más flexible, permite constraints arbitrarios  
**Cons**: No serializable, no inspeccionable, difícil de componer

**Decisión**: Descartada. Necesitamos constraints serializables y componibles.

### Alternativa 3: DSL para constraints

Crear un DSL (lenguaje específico de dominio) para definir constraints.

**Pros**: Más expresivo, más legible  
**Cons**: Overhead de implementación, curva de aprendizaje

**Decisión**: Descartada por ahora. Enum es suficiente para MVP. Revisitar si hay necesidad de constraints muy complejos.

## Related

- [ADR-0004: Evaluation Engine](ADR-0004-evaluation-engine.md)
- [ADR-0005: Planning Assistant](ADR-0005-planning-assistant.md)
- [Especificación: Analyze Plan](../intelligent-planning/specs/analyze-plan.md)
