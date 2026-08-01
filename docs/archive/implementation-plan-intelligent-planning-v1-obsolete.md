# Plan de Implementación — Thalos Intelligent Planning

> **Obsoleto**: pipeline de planificación unificado — ver `openspec/changes/unified-ir-pipeline/` para el modelo canónico actual (IR-0 → IR-3).

## Visión

**Objetivo final**: Convertir Thalos en una plataforma de planificación robótica basada en conocimiento, donde el usuario expresa objetivos y restricciones, y el sistema analiza, planifica, optimiza y explica automáticamente las soluciones.

**Principio rector**: La IA es el medio, no el producto. El usuario nunca debe pensar en "Constraint Engine" o "CostEvaluator". Piensa en "mover esta pieza de A a B priorizando seguridad".

**Principio arquitectónico**: No construir componentes porque "están en el roadmap". Cada nuevo componente debe habilitar una capability visible para el usuario. La arquitectura crece impulsada por funcionalidades de producto, no por acumulación de infraestructura.

---

## Pipeline Central

Toda decisión de planificación pasa por este pipeline:

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

Este pipeline es el backbone arquitectónico. Cada fase del roadmap agrega capacidades a una o más etapas de este pipeline.

---

## Evolución del Producto

Thalos evoluciona en tres niveles de interacción con el usuario:

**Nivel 1 — Asistencia**: Thalos valida y analiza lo que el usuario hace ("este plan tiene una singularidad", "esta trayectoria es válida")

**Nivel 2 — Automatización**: Thalos propone alternativas y genera trayectorias automáticamente a partir de objetivos y restricciones

**Nivel 3 — Colaboración**: Thalos se convierte en un asistente de planificación. El usuario define la intención y el sistema explica las opciones, justifica sus decisiones y permite comparar soluciones

En ese punto, la IA deja de ser un conjunto de algoritmos internos y se convierte en una característica visible del producto: un sistema que ayuda al usuario a tomar mejores decisiones sin exigirle conocer los detalles matemáticos.

---

## Dos Productos en Uno

Thalos realmente contiene dos productos que evolucionan en paralelo:

### Producto A — Plataforma de Robótica (el motor)

```
URDF → FK → IK → Planning → Runtime → Execution
```

Esto es la infraestructura técnica. Provee las capacidades fundamentales de cinemática, planificación y ejecución. Es lo que Thalos ya tiene hoy.

### Producto B — Asistente Inteligente (la experiencia)

```
Analyze → Advise → Explain → Optimize → Learn → Adapt
```

Esto es la capa de inteligencia. Consume el motor y agrega valor mediante análisis, recomendaciones, explicaciones y optimización. Es lo que este roadmap construye.

**Relación de dependencia**: El Producto B depende del Producto A, nunca al revés. El asistente inteligente no puede recomendar ni explicar si no hay un motor que ejecute. Pero el motor puede existir sin el asistente (como hoy).

Esta separación es importante porque:
- El motor es reutilizable por otros sistemas (ROS, otras UIs)
- El asistente es el diferenciador de producto
- Puedes mejorar uno sin tocar el otro

---

## Usuarios Objetivo por Nivel

| Nivel | Usuario | Qué espera | Ejemplo de uso |
|-------|---------|------------|----------------|
| 1 | **Estudiante de robótica** | Ver si un movimiento es correcto | "¿Mi MoveJ tiene singularidades?" |
| 2 | **Integrador de sistemas** | Encontrar una trayectoria mejor sin ajustar parámetros | "Dame 3 alternativas para este movimiento" |
| 3 | **Ingeniero de automatización** | Definir restricciones de producción | "El TCP debe mantenerse vertical y evitar esta zona" |
| 4 | **Desarrollador de aplicaciones** | Trabajar con tareas de alto nivel | "Mover pieza de A a B" (sin especificar movimientos) |
| 5 | **Operador / mantenimiento** | Aprender del comportamiento real del robot | "¿Por qué este movimiento tarda más de lo esperado?" |
| 6-7 | **Integrador industrial** | Supervisar hardware y adaptarse a fallos | "El motor está caliente, reducir velocidad automáticamente" |

Esta tabla justifica por qué existe cada fase: cada nivel sirve a un usuario diferente con necesidades diferentes.

---

## Fuera del Alcance

Para mantener la identidad clara del proyecto, Thalos **NO**:

- **No reemplaza un PLC** — no ejecuta lógica de control industrial
- **No realiza control PID** — no cierra loops de control en tiempo real
- **No ejecuta control en tiempo real** — no garantiza latencias determinísticas
- **No reemplaza firmware** — no corre en microcontroladores
- **No es un sistema de visión artificial** — no procesa imágenes ni detecta objetos
- **No utiliza modelos generativos** — no usa LLMs ni redes neuronales para planificar
- **No simula física** — no modela dinámica, fuerzas, ni contacto
- **No reemplaza ROS 2** — no publica topics ni usa actionlib
- **No es un renderer 3D** — delega visualización a Three.js

Thalos **SÍ**:

- Es una plataforma de planificación robótica basada en conocimiento
- Analiza, planifica, optimiza y explica movimientos
- Propone alternativas y justifica decisiones
- Aprende de ejecuciones anteriores
- Se adapta a restricciones y fallos

Esta claridad evita que el alcance se dispare y mantiene el foco en lo que hace especial a Thalos.

---

## Feature MVP — "Analyze Plan"

Antes de implementar fases completas, empezar con una única funcionalidad visible que demuestre la filosofía completa del producto.

### Lo que el usuario ve

```
Usuario crea un MoveJ
  ↓
Presiona "Analyze"
  ↓
Thalos responde:
  ✓ Tiempo estimado: 2.3 s
  ⚠ Singularidad cerca del waypoint 5
  ⚠ Distancia mínima a obstáculo: 18 mm
  ✓ Manipulabilidad promedio: 0.72
  
  Sugerencias:
  • Cambiar solución IK (aumenta manipulabilidad 15%)
  • Reducir velocidad máxima a 0.8 m/s
  • Agregar waypoint intermedio para evitar singularidad
```

### Por qué este feature primero

Este feature demuestra la filosofía completa sin necesidad de optimizar nada:
- **Analiza** (detecta problemas)
- **Explica** (reporta métricas)
- **Recomienda** (sugiere mejoras)

Y además fuerza a construir una buena arquitectura desde el principio:
- Analizadores independientes (manipulabilidad, singularidad, colisión)
- Un modelo común de resultados (`AnalysisReport`)
- Un `Advisor` que consume esos análisis

### Implementación mínima

- `TrajectoryAnalyzer` que consume `ManipulabilityAnalyzer`, `SingularityAnalyzer`, `CollisionAnalyzer`
- `Advisor` que genera sugerencias basadas en análisis
- API endpoint: `POST /plan/analyze`
- Frontend: botón "Analyze" + panel de resultados

**Esfuerzo**: 1-2 semanas | **Dependencias**: Collision queries con distancia

Este es el punto de entrada al Producto B (asistente inteligente). Una vez que funciona, el resto de las fases son extensiones naturales.

---

## Fase 1 — Comprender

**Capability del usuario**: El usuario crea un plan y Thalos le dice qué problemas tiene antes de ejecutarlo.

**Usuario objetivo**: Estudiante de robótica, integrador de sistemas

**Pipeline stage**: Analysis

### Lo que el usuario ve

```
Usuario crea programa (MoveJ, MoveL, MoveJ)
  ↓
Presiona "Analizar"
  ↓
Thalos responde:
  ⚠ manipulabilidad baja en waypoint 4
  ⚠ trayectoria pasa a 5 mm del obstáculo
  ✓ tiempo estimado 4.2 s
  ✓ sin singularidades
```

### Implementación interna

#### Análisis Automático de Trayectorias
- `thalos-planning::analysis::TrajectoryAnalyzer`
- `analyze(trajectory, chain, constraints) -> AnalysisReport`
- Report: manipulabilidad por waypoint, distancia a obstáculos, tiempo, singularidades

#### Constraint System Básico
- `thalos-core::analysis::constraints::Constraint` (enum)
  - `JointLimit`, `OrientationCone`, `CartesianBox`, `Composite`
- `ConstraintEvaluator::check(state, chain, tcp) -> Result<(), ConstraintViolation>`
- Validación binaria (satisfecho/no satisfecho)

#### Collision Queries con Distancia
- `thalos-collision::distance::DistanceQuery`
- `min_distance(bodies, robot_state) -> f64`
- Implementación inicial: naive O(n²), después BVH

### Entregables
- ✅ Usuario crea plan → recibe análisis automático con warnings
- ✅ Usuario define constraints → planificador valida antes de ejecutar
- ✅ API: `POST /plan/analyze` con reporte estructurado

**Esfuerzo**: 2-3 semanas | **Dependencias**: Ninguna

---

## Fase 2 — Mejorar

**Capability del usuario**: El usuario define un objetivo y Thalos le propone múltiples alternativas, las compara, y le recomienda la mejor.

**Usuario objetivo**: Integrador de sistemas, ingeniero de automatización

**Pipeline stages**: Evaluation, Planning, Explanation

### Lo que el usuario ve

```
Usuario define objetivo: "Mover TCP a esta pose"
  ↓
Presiona "Generar alternativas"
  ↓
Thalos genera 3 planes con diferentes estrategias
  ↓
Presiona "Comparar"
  ↓
Tabla comparativa:
  | Plan | Tiempo | Energía | Seguridad | Suavidad |
  | A    | 2.1 s  | Alta    | Media     | Baja     |
  | B    | 2.8 s  | Baja    | Alta      | Alta     |
  | C    | 2.5 s  | Media   | Alta      | Muy alta |
  ↓
Presiona "Recomendar"
  ↓
Thalos sugiere: "Plan C — mejor balance general"
```

### Implementación interna

#### Interpoladores Avanzados
- `thalos-planning::interpolate::Interpolator` (trait)
  - `LinearInterpolator` (actual)
  - `CubicSplineInterpolator` (nuevo, default)
  - `QuinticSplineInterpolator` (opcional)
- Continuidad C² en vez de rampas lineales

#### Weighted IK Solver
- `thalos-core::kinematics::inverse::IkCostFunction` (trait)
  - `weight(joint: usize, ctx: &IKContext) -> f64`
- Implementaciones: `UniformWeight`, `MinimizeMovement`, `AvoidSingularity`
- `WeightedDLS` solver que consume `IkCostFunction`

#### Evaluation Engine
- `thalos-core::analysis::evaluation::CostEvaluator` (trait)
  - `evaluate_trajectory(trajectory, chain) -> f64`
  - `evaluate_state(state, chain) -> f64`
- Implementaciones:
  - `ManipulabilityCost` (1 - manipulabilidad normalizada)
  - `SingularityCost` (inverso de distancia a singularidad)
  - `ObstacleCost` (inverso de distancia mínima a obstáculo)
  - `EnergyCost` (estimación basada en movimiento articular)
  - `CompositeEvaluator` (suma ponderada)

#### Comparador de Planes
- `thalos-planning::comparison::PlanComparator`
- `compare(plans: &[CompiledPlan], chain: &SerialChain) -> ComparisonTable`
- Métricas: tiempo, energía, manipulabilidad promedio, distancia a obstáculos

#### Advisor (Recomendaciones)
- `thalos-planning::advisor::PlanAdvisor`
- `advise(plan: &CompiledPlan, chain: &SerialChain) -> Vec<Recommendation>`
- Recomendaciones:
  - "Cambiar configuración inicial aumenta 20% manipulabilidad"
  - "Hay trayectoria 15% más corta"
  - "Conviene usar solución IK alternativa"

### Entregables
- ✅ Usuario define objetivo → Thalos genera 2-3 planes alternativos
- ✅ Usuario compara planes en tabla con métricas
- ✅ Usuario recibe recomendación automática
- ✅ Trayectorias con continuidad C² (splines cúbicos)
- ✅ IK con pesos configurables

**Esfuerzo**: 3-4 semanas | **Dependencias**: Fase 1 (Collision queries)

---

## Fase 3 — Restringir

**Capability del usuario**: El usuario define restricciones y prioridades, y Thalos encuentra la mejor trayectoria que las respeta.

**Usuario objetivo**: Ingeniero de automatización

**Pipeline stages**: Constraints, Evaluation, Optimization, Explanation

### Lo que el usuario ve

```
Usuario define objetivo: "Mover TCP a esta pose"
  ↓
Define restricciones:
  ✓ mantener orientación vertical
  ✓ evitar esta caja
  ✓ no superar velocidad de 0.5 m/s
  ↓
Ajusta prioridades con sliders:
  Rapidez ◀────────────▶ Suavidad
  Seguridad ◀────────────▶ Tiempo
  ↓
Presiona "Optimizar"
  ↓
Thalos genera trayectoria optimizada
  ↓
Presiona "¿Por qué esta trayectoria?"
  ↓
Thalos explica:
  "Trayectoria A descartada: colisión con obstáculo
   Trayectoria B descartada: viola restricción de orientación
   Trayectoria C elegida: menor costo total respetando todas las restricciones"
```

### Implementación interna

#### Constraint System con Costos
- `ConstraintResult { satisfied: bool, penalty: f64 }`
- `Constraint::evaluate(state, chain, tcp) -> ConstraintResult`
- Penalización suave: `penalty = max(0, violation_magnitude)`
- Extensión del Constraint System de Fase 1

#### Trajectory Optimizer
- `thalos-planning::trajectory::TrajectoryOptimizer` (trait)
- `optimize(initial: Trajectory, evaluators: &[CostEvaluator], constraints: &[Constraint]) -> Trajectory`
- Implementaciones:
  - `GradientDescentOptimizer` (baseline)
  - `TimeOptimalOptimizer` (minimiza tiempo respetando límites)
  - `CHOMPOptimizer` (opcional, requiere crate externo)

#### Explicador de Decisiones
- `thalos-planning::explanation::PlanExplainer`
- `explain(chosen: &CompiledPlan, alternatives: &[CompiledPlan], constraints: &[Constraint]) -> Explanation`
- Aplica a motion planning Y task planning
- Explicación: "Trayectoria A descartada (colisión), B descartada (singularidad), C elegida (menor costo)"

#### Optimización Interactiva
- Frontend: sliders "Rapidez ↔ Suavidad", "Seguridad ↔ Tiempo"
- Backend: `POST /plan/optimize-interactive` con pesos
- Re-planifica con nuevos pesos y actualiza visualización en tiempo real

### Entregables
- ✅ Usuario define objetivo + restricciones → Thalos optimiza trayectoria
- ✅ Usuario ajusta prioridades con sliders → trayectoria se actualiza en tiempo real
- ✅ Sistema explica por qué eligió esa trayectoria
- ✅ Usuario puede inspeccionar alternativas descartadas

**Esfuerzo**: 4-5 semanas | **Dependencias**: Fase 2 (Evaluation Engine, Comparador)

---

## Fase 4 — Automatizar

**Capability del usuario**: El usuario define una tarea ("mover pieza de A a B") sin especificar movimientos, y Thalos genera el programa completo.

**Usuario objetivo**: Desarrollador de aplicaciones, integrador de sistemas

**Pipeline stages**: Goal, Planning, Explanation

### Lo que el usuario ve

```
Usuario define tarea:
  "Mover pieza desde Bandeja A hasta Prensa"
  ↓
Presiona "Generar programa"
  ↓
Thalos genera:
  MoveJ (approach a Bandeja A)
  MoveL (descenso)
  Cerrar pinza
  MoveL (retiro)
  MoveJ (transfer a Prensa)
  MoveL (aproximación)
  Abrir pinza
  MoveL (retiro)
  MoveJ (home)
  ↓
Presiona "¿Por qué este programa?"
  ↓
Thalos explica:
  "Approach desde arriba para evitar colisión con bandeja
   Transfer por camino libre de obstáculos
   Aproximación final perpendicular a prensa"
```

### Implementación interna

#### Task Planner Simbólico
- `thalos-planning::task::TaskGoal` (enum)
  - `Transfer { object: ObjectId, from: Pose, to: Pose }`
  - `Pick { object: ObjectId, at: Pose }`
  - `Place { object: ObjectId, at: Pose }`
- `TaskPlanner::decompose(goal, chain, constraints) -> MotionProgram`
- Políticas de approach/retreat (configurables)
- Valida cada segmento con Constraint System antes de retornar

### Entregables
- ✅ Usuario define tarea de alto nivel → Thalos genera programa completo
- ✅ Sistema explica decisiones de descomposición
- ✅ Usuario puede editar segmentos generados

**Esfuerzo**: 3-4 semanas | **Dependencias**: Fase 3 (Constraint System con costos)

---

## Fase 5 — Aprender

**Capability del usuario**: Thalos aprende de ejecuciones anteriores y mejora automáticamente parámetros para futuras planificaciones.

**Usuario objetivo**: Operador, mantenimiento

**Pipeline stage**: Execution, Evaluation

### Lo que el usuario ve

```
Usuario ejecuta Plan A
  ↓
Tiempo real: 2.5 s (estimado: 2.1 s)
  ↓
Thalos guarda resultado
  ↓
Después de 50 ejecuciones similares:
  ↓
Thalos sugiere:
  "Para este tipo de movimiento, usar velocidad 0.8 m/s
   en lugar de 1.0 m/s (más preciso en ejecución real)"
  ↓
Usuario acepta
  ↓
Futuras planificaciones usan parámetros ajustados
```

### Implementación interna

#### Execution Logger
- `thalos-runtime::learning::ExecutionLogger`
- `log(plan: &CompiledPlan, actual_metrics: ExecutionMetrics)`
- Guarda: tiempo real, energía consumida, errores, desviaciones

#### Parameter Adjuster
- `thalos-runtime::learning::ParameterAdjuster`
- `suggest_adjustments(task_type: TaskKind, history: &[ExecutionLog]) -> Vec<ParameterSuggestion>`
- Ajusta: velocidades máximas, aceleraciones, lambda del DLS, pesos de IK
- Basado en estadísticas de ejecuciones anteriores

#### Learning Dashboard
- Frontend: panel de aprendizaje con historial de ejecuciones
- Muestra: desviaciones promedio, sugerencias de ajuste, confianza

### Entregables
- ✅ Thalos guarda métricas de cada ejecución
- ✅ Después de N ejecuciones, sugiere ajustes de parámetros
- ✅ Usuario puede aceptar/rechazar sugerencias
- ✅ Parámetros ajustados se usan en futuras planificaciones

**Esfuerzo**: 2-3 semanas | **Dependencias**: Fase 2 (Evaluation Engine), Execution pipeline estable

---

## Fase 6 — Adaptarse

**Capability del usuario**: Consultas de alcanzabilidad instantáneas con incertidumbre cuantificada.

**Usuario objetivo**: Integrador de sistemas, ingeniero de automatización

**Pipeline stage**: Analysis

### Condición de implementación

Solo implementar si existe un caso de uso concreto que justifique la complejidad matemática:
- Consultas interactivas de alcanzabilidad con latencia < 10ms
- Modelado probabilístico del workspace con incertidumbre
- Optimización de parámetros con hardware real

Si el Monte Carlo actual resuelve el problema en tiempo aceptable, no introducir GP.

### Implementación interna

#### GP-Based Workspace Model
- `thalos-core::analysis::workspace::GPWorkspaceModel`
- `predict(position: Vector3) -> ReachabilityPrediction` (probabilidad + intervalo de confianza)
- Entrenado con muestras de `WorkspaceSampler`
- Usar inducing points (subset de 500-1000 muestras) para escalar

#### Bayesian Parameter Tuning
- `thalos-runtime::tuning::ParameterTuner`
- `tune(objective: MetricKind, param_space: ParamSpace) -> OptimalParams`
- Optimización Bayesiana de parámetros del planificador
- Requiere crate externo (`argmin` o similar)

### Entregables
- ✅ Consultas de alcanzabilidad con probabilidad + incertidumbre
- ✅ Optimización automática de parámetros basada en métricas

**Esfuerzo**: 2-3 semanas | **Dependencias**: Crate externo (`linfa` o `gaussian-process-rs`, `argmin`)

---

## Fase 7 — Supervisar

**Capability del usuario**: Thalos detecta problemas de hardware y adapta la planificación automáticamente.

**Usuario objetivo**: Integrador industrial, operador

**Pipeline stage**: Execution, Planning

### Condición de implementación

Solo implementar cuando haya integración con hardware real (Fase 4 del roadmap original: Controllers).

### Lo que el usuario ve

```
Usuario ejecuta trayectoria
  ↓
Thalos detecta: "Stepper pierde pasos"
  ↓
Automáticamente:
  - Reduce velocidad 20%
  - Replanifica con nuevos parámetros
  - Notifica al usuario
  ↓
Usuario ve:
  "⚠ Problema detectado: pérdida de pasos
   Acción: velocidad reducida, trayectoria replanificada"
```

### Implementación interna

#### Health Monitor
- `thalos-runtime::health::HealthMonitor`
- `monitor(execution: &ExecutionState) -> Vec<HealthAlert>`
- Detecciones:
  - Pérdida de pasos (desviación posición real vs esperada)
  - Temperatura de motor (si hay sensor)
  - Vibración anómala (si hay acelerómetro)

#### Adaptive Replanning
- `thalos-runtime::health::AdaptiveReplanner`
- `replan(current_plan: &CompiledPlan, alerts: &[HealthAlert]) -> CompiledPlan`
- Ajusta: reduce velocidad, limita aceleración, evita configuraciones problemáticas

### Entregables
- ✅ Thalos detecta problemas de hardware en tiempo real
- ✅ Replanifica automáticamente con parámetros conservadores
- ✅ Notifica al usuario con explicación

**Esfuerzo**: 3-4 semanas | **Dependencias**: Controllers reales (Fase 4 del roadmap original), sensores de hardware

---

## Roadmap Consolidado

```
Feature MVP — "Analyze Plan" (1-2 semanas)
├─ TrajectoryAnalyzer
├─ Advisor (sugerencias)
└─ API /plan/analyze

Fase 1 — Comprender (2-3 semanas)
├─ Análisis automático de trayectorias
├─ Constraint System básico
└─ Collision queries con distancia

Fase 2 — Mejorar (3-4 semanas)
├─ Interpoladores avanzados
├─ Weighted IK Solver
├─ Evaluation Engine
├─ Comparador de planes
└─ Advisor (recomendaciones)

Fase 3 — Restringir (4-5 semanas)
├─ Constraint System con costos
├─ Trajectory Optimizer
├─ Explicador de decisiones
└─ Optimización interactiva

Fase 4 — Automatizar (3-4 semanas)
└─ Task Planner simbólico

Fase 5 — Aprender (2-3 semanas)
├─ Execution Logger
├─ Parameter Adjuster
└─ Learning Dashboard

Fase 6 — Adaptarse (2-3 semanas, condicional)
├─ GP-Based Workspace Model (si hay caso de uso)
└─ Bayesian Parameter Tuning (si hay hardware real)

Fase 7 — Supervisar (3-4 semanas, post-MVP)
├─ Health Monitor
└─ Adaptive Replanning
```

**Total estimado**: 18-24 semanas (4.5-6 meses) para Feature MVP + Fases 1-5
**Fases 6-7**: Condicionales, solo si hay necesidad demostrable

---

## Dependencias Críticas

```
Feature MVP (Analyze Plan)
  ↓
Collision Queries (Fase 1)
  ↓
Evaluation Engine (Fase 2) ← consume collision + manipulability
  ↓
Advisor (Fase 2) ← recomienda basado en evaluation
  ↓
Constraint System con costos (Fase 3) ← habilita optimizer
  ↓
Trajectory Optimizer (Fase 3) ← minimiza evaluation + constraints
  ↓
Explicador (Fase 3) ← explica decisiones del optimizer
  ↓
Task Planner (Fase 4) ← usa todo lo anterior
  ↓
Execution Logger (Fase 5) ← aprende de ejecuciones
```

**Secuencia obligatoria**: Feature MVP → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5

---

## Métricas de Éxito

### Feature MVP — "Analyze Plan"
- [ ] Usuario presiona "Analyze" y recibe reporte en < 100ms
- [ ] Reporte incluye: tiempo, singularidades, distancia a obstáculos, manipulabilidad
- [ ] Advisor genera al menos 1 sugerencia útil por plan

### Fase 1 — Comprender
- [ ] Análisis automático detecta singularidades, colisiones cercanas, manipulabilidad baja
- [ ] API `/plan/analyze` responde en < 100ms para trayectorias de 100 waypoints
- [ ] Usuario puede definir constraints y validarlos antes de ejecutar

### Fase 2 — Mejorar
- [ ] Trayectorias con splines cúbicos tienen jerk < 50% vs interpolación lineal
- [ ] IK con pesos reduce movimiento de joints pesados en 30%+
- [ ] Comparador genera 3 alternativas en < 500ms
- [ ] Advisor genera al menos 1 recomendación útil por plan

### Fase 3 — Restringir
- [ ] Optimizador reduce costo total en 20%+ vs plan inicial
- [ ] Optimización interactiva actualiza trayectoria en < 200ms
- [ ] Explicador identifica correctamente razón de descarte en 90%+ de casos

### Fase 4 — Automatizar
- [ ] Task Planner descompone "pick and place" en < 10 segmentos válidos
- [ ] 100% de segmentos generados pasan validación de Constraint System

### Fase 5 — Aprender
- [ ] Después de 50 ejecuciones, sugerencias reducen desviación tiempo real vs estimado en 30%+
- [ ] Usuario acepta > 70% de sugerencias de ajuste

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| Trajectory Optimizer no converge | Media | Empezar con gradient descent simple, agregar CHOMP solo si es necesario |
| Evaluation Engine demasiado lento | Baja | Cachear evaluaciones por robot, recalcular solo cuando cambie escena |
| Constraint System muy restrictivo | Media | Permitir "soft constraints" con penalty en vez de rechazo |
| GP no escala a 10k+ samples | Alta | Usar inducing points (subset de 500-1000 muestras) |
| Task Planner genera planes inválidos | Media | Validar cada segmento con Constraint System antes de retornar |
| Learning sugiere ajustes incorrectos | Baja | Requerir confirmación del usuario, mostrar confianza de sugerencia |
| Health Monitor falsos positivos | Media | Umbral conservador, permitir deshabilitar detecciones específicas |

---

## Rollback Plan

Cada fase es independiente. Si una fase falla:
- **Feature MVP**: Deshabilitar botón "Analyze", revertir a planificación manual
- **Fase 1 (Comprender)**: Revertir a planificación manual sin análisis automático
- **Fase 2 (Mejorar)**: Revertir a interpolación lineal y IK sin pesos, deshabilitar Advisor
- **Fase 3 (Restringir)**: Deshabilitar optimizer, usar planificación sin optimización
- **Fase 4 (Automatizar)**: Revertir a planificación manual de segmentos
- **Fase 5 (Aprender)**: Deshabilitar sugerencias de aprendizaje
- **Fase 6 (Adaptarse)**: Simplemente no implementar (es condicional)
- **Fase 7 (Supervisar)**: Simplemente no implementar (es condicional)

Todas las fases mantienen backward compatibility con la anterior.

---

## Notas de Implementación

### Prioridades dentro de cada fase

**Feature MVP**: Empezar por TrajectoryAnalyzer + Advisor porque demuestra la filosofía completa.

**Fase 1 (Comprender)**: Empezar por Collision Queries porque es prerequisito para todo lo demás.

**Fase 2 (Mejorar)**: Empezar por Interpoladores porque es el cambio más simple y visible. Advisor puede desarrollarse en paralelo.

**Fase 3 (Restringir)**: Empezar por Constraint System con costos porque habilita el optimizer. Explicador puede desarrollarse en paralelo.

**Fase 4 (Automatizar)**: Task Planner es el único componente, no hay prioridad interna.

**Fase 5 (Aprender)**: Empezar por Execution Logger porque es prerequisito para Parameter Adjuster.

### Testing

- **Unit tests**: Cada componente nuevo con tests de invariantes
- **Integration tests**: End-to-end desde API hasta resultado
- **Benchmarks**: Medir latencia de `/plan/analyze`, `/plan/compare`, `/plan/optimize`
- **Snapshots**: Visualizaciones de trayectorias optimizadas vs no optimizadas
- **User testing**: Validar que capabilities sean intuitivas para usuarios sin conocimiento técnico

### Documentación

- Actualizar `docs/maturity.qmd` con estado de cada capability
- Agregar ADRs para decisiones arquitectónicas (ej: "ADR-0003: Evaluation Engine vs Cost Maps")
- Documentar API endpoints nuevos en `docs/api.qmd`
- Crear guías de usuario para cada capability (ej: "Cómo usar el Advisor")

---

## Conclusión

Este plan evoluciona Thalos desde una herramienta de planificación manual hacia un **copiloto para planificación robótica**, donde la IA no reemplaza al ingeniero, sino que le ayuda a comprender, mejorar, restringir, automatizar, aprender y adaptarse.

Cada fase está organizada por **capabilities que percibe el usuario**, no por componentes técnicos:

- **Comprender**: El usuario entiende qué problemas tiene su plan
- **Mejorar**: El usuario recibe alternativas y recomendaciones
- **Restringir**: El usuario define reglas y el sistema las respeta
- **Automatizar**: El usuario define tareas de alto nivel
- **Aprender**: El sistema mejora con cada ejecución
- **Adaptarse**: El sistema responde a incertidumbre y fallos
- **Supervisar**: El sistema monitorea hardware y se adapta

El usuario nunca necesita entender "Constraint Engine" o "Evaluation Engine" — solo define objetivos y restricciones, y el sistema propone, optimiza y explica.

### Propuesta de valor

Si alguien pregunta *"¿qué hace especial a Thalos frente a un simple simulador?"*, la respuesta ya no será *"usa DLS y splines"*. Será:

> **Thalos ayuda al ingeniero a planificar, evaluar, optimizar y comprender movimientos robóticos, proponiendo alternativas y explicando sus decisiones.**

Esa es una propuesta de valor mucho más clara, tanto para usuarios como para una posible defensa académica.

### Identidad del producto

Thalos no es:
- Un simulador físico
- Un controlador industrial
- Un sistema de visión
- Un reemplazo de ROS

Thalos **sí** es:
- Un copiloto para planificación robótica
- Un asistente que analiza, recomienda y explica
- Una plataforma que aprende y se adapta
- Un puente entre la cinemática pura y la toma de decisiones informada

Esa identidad es lo que diferencia a Thalos de cualquier otra herramienta de robótica.
