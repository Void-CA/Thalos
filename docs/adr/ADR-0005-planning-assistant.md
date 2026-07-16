# ADR-0005: Planning Assistant

## Status

Proposed

## Context

Thalos evoluciona de ser una plataforma de planificación manual a un asistente inteligente que analiza, recomienda, explica y optimiza trayectorias.

Este cambio requiere:
- Separar el "motor" (cinemática, planificación, ejecución) del "asistente" (análisis, recomendaciones, optimización)
- Definir capabilities claras que el usuario percibe
- Mantener el motor reutilizable por otros sistemas
- Evitar que el código conozca las fases del roadmap

### Problema

Hoy el usuario debe:
1. Crear escena manualmente
2. Elegir robot
3. Definir waypoints uno por uno
4. Ejecutar sin saber si el plan es óptimo
5. No recibe explicaciones de por qué un plan falló

### Solución

Un asistente que:
- **Analyze**: detecta problemas antes de ejecutar
- **Advise**: sugiere mejoras
- **Explain**: justifica decisiones
- **Optimize**: encuentra la mejor trayectoria
- **Learn**: mejora con ejecuciones
- **Adapt**: responde a fallos de hardware

## Decision

Implementar el asistente inteligente como una capa sobre el motor, con capabilities bien definidas.

### Arquitectura de dos productos

**Producto A — Motor** (existente):
```
URDF → FK → IK → Planning → Runtime → Execution
```

**Producto B — Asistente** (nuevo):
```
Analyze → Advise → Explain → Optimize → Learn → Adapt
```

**Relación**: B depende de A, nunca al revés.

### Pipeline central

```
Goal (objetivo del usuario)
  ↓
Analysis (análisis de viabilidad)
  ↓
Constraints (restricciones definidas)
  ↓
Evaluation (evaluación de costos)
  ↓
Planning (generación de trayectorias)
  ↓
Optimization (optimización multi-objetivo)
  ↓
Explanation (explicación de decisiones)
  ↓
Execution (ejecución y monitoreo)
```

### Capabilities como verbos

| Usuario pregunta | Sistema responde | Capability |
|------------------|------------------|------------|
| ¿Está bien mi plan? | Análisis | **Analyze** |
| ¿Cómo mejorarlo? | Recomendaciones | **Advise** |
| ¿Por qué elegiste esto? | Justificación | **Explain** |
| ¿Cuál es la mejor opción? | Optimización | **Optimize** |
| ¿Qué aprendimos? | Ajustes | **Learn** |
| ¿Cómo reaccionar a fallos? | Adaptación | **Adapt** |

### Principio clave

**El código no conoce las fases del roadmap**. 

`Analysis` no sabe que pertenece a "Fase 1". `Advisor` no sabe que pertenece a "Fase 2". Solo conocen capabilities.

Esto evita que la arquitectura quede contaminada por el roadmap.

### Integración con el motor

El asistente consume el motor a través de interfaces bien definidas:

| Motor (Producto A) | Asistente (Producto B) | Interfaz |
|--------------------|------------------------|----------|
| `ForwardKinematics` | `ManipulabilityAnalyzer` | `fk.evaluate(q)` |
| `GeometricJacobian` | `SingularityAnalyzer` | `jacobian.evaluate(q)` |
| `CollisionChecker` | `CollisionAnalyzer` | `checker.check(bodies)` |
| `MotionPlanner` | `TrajectoryOptimizer` | `planner.plan(ctx, goal)` |
| `ExecutionService` | `ExecutionLogger` | `service.execute(plan)` |

El motor no sabe que existe el asistente. El asistente sabe que existe el motor.

## Consequences

### Positivas

- **Separación de responsabilidades**: motor vs asistente
- **Reutilización**: motor puede ser consumido por otros sistemas (ROS, otras UIs)
- **Evolución independiente**: puedes mejorar asistente sin tocar motor
- **Identidad clara**: "Thalos es un copiloto para planificación robótica"
- **Capabilities visibles**: usuario percibe valor, no algoritmos

### Negativas

- **Complejidad arquitectónica**: dos productos en vez de uno
- **Overhead de integración**: asistente debe consumir motor via interfaces
- **Documentación**: más conceptos que explicar

### Neutrales

- **Dependencias**: asistente depende de motor (unidireccional)
- **Breaking changes**: ninguna (asistente es capa nueva)

## Alternatives Considered

### Alternativa 1: Integrar asistente en motor

Mezclar análisis, optimización, y recomendaciones directamente en planning y runtime.

**Pros**: Menos capas, más simple  
**Cons**: Motor no reutilizable, arquitectura contaminada, difícil de mantener

**Decisión**: Descartada. Separación motor/asistente es clave para reutilización y evolución.

### Alternativa 2: Asistente como microservicio separado

Implementar asistente como servicio HTTP separado del motor.

**Pros**: Desacoplamiento total, escalabilidad independiente  
**Cons**: Overhead de red, complejidad de deployment, latencia

**Decisión**: Descartada por ahora. Asistente como capa dentro del mismo proceso es suficiente. Revisitar si hay necesidad de escalabilidad.

### Alternativa 3: Asistente solo para frontend

Implementar asistente solo en frontend (Angular), no en backend.

**Pros**: Menos código en backend  
**Cons**: No reutilizable por otros clientes, lógica de negocio en frontend

**Decisión**: Descartada. Asistente debe estar en backend para ser reutilizable y testeable.

## Filosofía

**La IA es el medio, no el producto**.

El usuario nunca piensa en "Constraint Engine" o "Evaluation Engine". Piensa en "mover esta pieza de A a B priorizando seguridad".

**Inversión de prioridades**:

Antes: "¿Implementamos Gaussian Processes?"  
Ahora: "¿Qué necesita el usuario para tomar mejores decisiones?" → elegimos técnica

**Identidad del producto**:

> Thalos ayuda al ingeniero a planificar, evaluar, optimizar y comprender movimientos robóticos, proponiendo alternativas y explicando sus decisiones.

## Related

- [ADR-0003: Constraint System](ADR-0003-constraint-system.md)
- [ADR-0004: Evaluation Engine](ADR-0004-evaluation-engine.md)
- [Visión](../intelligent-planning/vision.md)
- [Arquitectura](../intelligent-planning/architecture/planning-assistant.md)
