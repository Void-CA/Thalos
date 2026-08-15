# Evaluación Inteligente de Trayectorias Robóticas en Thalos

## Sistema experto difuso para el diagnóstico de planes de movimiento

**Proyecto:** Thalos — planificación y análisis de movimiento robótico (SCARA R-R-P-R)
**Componente:** `thalos-intelligence` (Rust, puro, sin I/O)
**Ámbito:** Asignatura de Inteligencia Artificial — IA clásica (lógica difusa, sistemas expertos, planificación automática)
**Estado:** componente congelado, batería de regresión en verde

---

## Resumen

Este trabajo presenta el componente de **evaluación inteligente** de Thalos: un sistema híbrido que combina un **sistema experto con encadenamiento hacia adelante** y una **capa de lógica difusa Mamdani** para diagnosticar la calidad de trayectorias robóticas. El componente lee el informe de análisis emitido por el pipeline real (`AnalysisReport`) y produce un veredicto de riesgo (Low / Medium / High / Critical), una calidad normalizada, una traza auditable del razonamiento y evidencia.

Este trabajo implementa técnicas de **IA clásica** —lógica difusa y sistemas expertos— para convertir evidencia geométrica real en una evaluación explicable de riesgo; no depende de modelos de aprendizaje.

La contribución central no es únicamente la implementación de las técnicas, sino la **metodología experimental**: la base de conocimiento fue auditada con escenarios controlados, recalibrada tras detectar inconsistencias semánticas, validada en fronteras, e integrada con el pipeline real. Esa integración reveló —y permitió corregir— una **pérdida de evidencia local** en la representación de entrada: fenómenos que el analizador detecta con precisión quedaban diluidos al agregarse sobre la trayectoria completa.

El resultado es un componente con semántica estable, evidencia de integración real (una trayectoria atraviesa el pipeline completo y produce una decisión inteligente diferente debido a evidencia geométrica real) y una traza que explica por qué.

---

## 1. Introducción y contexto

Thalos es un sistema de planificación y análisis de movimiento para robots industriales. Su pipeline produce trayectorias a partir de programas de movimiento, las analiza geométricamente —manipulabilidad, singularidades, colisiones— y genera un `AnalysisReport` con dos clases de información:

- **Métricas agregadas**: `avg_manipulability`, `min_collision_distance`, `near_singular_count`, `singular_count`, `waypoint_count`, `trajectory_duration`, etc.
- **Observaciones canónicas**: hechos localizados que el analizador emite (`LowManipulability`, `NearSingularity`, `Singularity`, `CollisionRisk`, …) con severidad, ubicación y atributos tipados.

El problema abordado: aunque el pipeline ya detectaba y clasificaba fenómenos geométricos, no existía una capa que **integrara esas señales en una evaluación gradual y explicable del riesgo global de la trayectoria**. Este trabajo añade esa capa: un sistema experto difuso con razonamiento explicable.

El sistema se inscribe en tres de las técnicas de IA clásica del programa: **lógica difusa** (manejo de variables continuas e imprecisas), **sistemas expertos** (conocimiento operacional explícito y decisiones auditables) y **planificación automática** (el contexto de aplicación: el pipeline produce las trayectorias que el sistema evalúa).

---

## 2. Marco conceptual

### 2.1 Sistema experto (encadenamiento hacia adelante)

El componente implementa un sistema experto clásico con encadenamiento hacia adelante (`forward chaining`):

- **Memoria de trabajo**: hechos derivados (`low_manipulability`, `near_singularity`, `safe_clearance`, `good_manipulability`, …). Un hecho ausente cuenta como falso.
- **Base de reglas**: 11 reglas en la versión congelada, cada una con categoría (colisión, singularidad, manipulabilidad, trayectoria), prioridad (1–10), antecedentes tipados (`MetricIs` con grado difuso, `FactEquals` con hecho booleano) y consecuentes (`DeriveFact`, `MarkEvidence`, `RiskIs`). La versión inicial contenía 12; la regla asociada a `trajectory_complexity` fue eliminada durante la validación de integración (véase §4.7).
- **Agenda**: las reglas se evalúan en orden descendente de prioridad; una regla dispara cuando **todos** sus antecedentes se cumplen (activación = mínimo de los grados difusos, AND).
- **Encadenamiento**: los hechos derivados por una regla habilitan reglas posteriores en pasos siguientes — la composición de evidencia es un mecanismo real, no una lista de umbrales independientes.
- **Trazabilidad**: cada disparo registra `rule_id`, prioridad, ligaduras de antecedentes y hechos derivados, en orden exacto de ejecución.
- **Recomendación**: el componente asocia su diagnóstico con las acciones del `PlanAdvisor` (productor único de reparaciones); no introduce un mecanismo paralelo de recomendación.

### 2.2 Lógica difusa (Mamdani)

- **Variables lingüísticas de entrada** (3): manipulabilidad (`low`/`medium`/`high`), proximidad a singularidad (`low`/`medium`/`high`), clearance de colisión (`danger`/`near`/`safe`).
- **Funciones de membresía**: hombros (izquierdo/derecho), triángulos y trapezoides, **ancladas a los umbrales del analizador** (p. ej. `MANIPULABILITY_LOW_THRESHOLD = 0.3`, `NEAR_COLLISION_DISTANCE = 0.05`) mediante un contrato de anclaje verificado por tests.
- **Fuzzificación**: grado de pertenencia de cada entrada crisp en cada conjunto.
- **Reglas Mamdani**: antecedentes difusos → consecuente de riesgo (`RiskIs { Low | Medium | High | Critical }`).
- **Agregación**: máximo de las contribuciones activadas.
- **Defuzzificación**: centroide sobre 100 muestras en [0, 1] → **riesgo crisp**.
- **Salidas**: `risk` (categoría por umbrales: [0, .25) Low, [.25, .5) Medium, [.5, .75) High, [.75, 1] Critical) y `quality = 1 − riesgo crisp`.

### 2.3 Integración robótica

```
Programa de movimiento (MoveJ)
        ↓
PlanCompiler → trayectoria interpolada
        ↓
TrajectoryAnalyzer (IK real, checker de colisión) → AnalysisReport
        ↓
extracción de evidencia (global + local) → FuzzyInputs
        ↓
Assessor::assess → risk / quality / evidence / trace / recommendations
```

Esta integración es lo que diferencia el proyecto de un ejercicio aislado de lógica difusa: la entrada no es sintética, es la salida del pipeline real.

---

## 3. Arquitectura del componente

### 3.1 Separación de responsabilidades

El sistema mantiene una división explícita de tres roles:

| Rol | Pregunta que responde | Entrada |
|---|---|---|
| `TrajectoryAnalyzer` | ¿Qué fenómenos geométricos existen? | Trayectoria + cadena cinemática |
| `Assessor` (`thalos-intelligence`) | ¿Qué tan preocupante es la trayectoria en términos globales? | `AnalysisReport` |
| `PlanAdvisor` | ¿Qué fallo concreto ocurrió y cómo lo reparo? | Observaciones + programa + IK |

El `Assessor` es un **evaluador global**: no muta el reporte, no produce reparaciones y no conoce estructuras del analizador más allá del reporte canónico. El `PlanAdvisor` es el único productor de remediaciones.

### 3.2 Representación de entrada: `FuzzyInputs` (global + local)

La capa de entrada distingue explícitamente dos clases de evidencia:

- **Global** (agregados de toda la trayectoria): `avg_manipulability`.
- **Local** (fenómenos que la agregación perdería): `collision_clearance` (mínimo, extremo local por naturaleza) y `localized_singularity` (presencia/severidad de eventos de singularidad **tomada de las observaciones del analizador**, no de una fracción de waypoints).

```
AnalysisReport
    ├── métricas agregadas ──────────→ avg_manipulability (global)
    ├── min_collision_distance ──────→ collision_clearance (local)
    └── observaciones (Singularity /
        NearSingularity) ────────────→ localized_singularity (local)
```

La transformación observaciones → puntaje se realiza en la capa de extracción, no en la base de conocimiento: `kb.rs` permanece genérico y no conoce estructuras del analizador.

La clasificación global/local no implica que todas las variables locales se obtengan de la misma forma: `collision_clearance` usa el **mínimo** de distancia porque el peor clearance es precisamente el valor relevante para el riesgo de colisión, mientras que la singularidad requiere consultar las **observaciones** porque una frecuencia agregada puede diluir un evento puntual.

---

## 4. Metodología experimental

La base de conocimiento no fue escrita de una sola vez: fue sometida a un ciclo de **auditoría → detección de inconsistencias → recalibración → validación → integración real**, y cada etapa dejó evidencia. Esta sección relata ese ciclo.

### 4.1 KB v1: implementación inicial

La primera versión declaraba 12 reglas y 4 variables lingüísticas. Las funciones de membresía y los consecuentes de riesgo se anclaron a los umbrales documentados del analizador.

### 4.2 Auditoría de comportamiento (escenarios controlados)

Antes de modificar nada, se congeló el comportamiento actual en una batería de **escenarios de aceptación** (tests ejecutables que imprimen el riesgo crisp real y fijan la expectativa). La auditoría reveló inconsistencias semánticas:

| Escenario controlado | Comportamiento v1 (observado) | Semántica esperada |
|---|---|---|
| Trayectoria saludable | Low (0.185) | Low |
| Manipulabilidad marginal (0.29) | **High** (0.639) | Medium |
| Manipulabilidad claramente baja (0.1) | **Critical** (0.894) | High |
| Solo singularidad cercana (prox 0.9) | **Low (0.000)** | ≥ Elevated |
| Baja manipulabilidad + singularidad | Critical | High/Critical |
| Clearance crítico | Critical | Critical |

### 4.3 Detección de inconsistencias

**A. Bug semántico — la singularidad era inerte.** La regla `R09_near_singularity` derivaba el hecho `near_singularity` y marcaba evidencia, pero **no contribuía al riesgo** (sin consecuente `RiskIs`), y ningún hecho derivado la consumía. Un plan lleno de waypoints cerca de singularidad producía riesgo crisp 0.0 y veredicto *Low*: el sistema ignoraba su propia señal de singularidad.

**B. Error de calibración — la manipulabilidad baja sobre-escalaba.** La regla `R07_low_manipulability` derivaba el hecho `danger_zone` —el mismo que la regla de colisión `R03`—, y `R11` (`danger_zone AND low → Critical`) colapsaba, en la práctica, a *low → Critical*: cualquier plan con manipulabilidad marginal terminaba en *Critical*.

**C. Membresías mal orientadas.** El conjunto `low` era `Triangular(0, 0.3, 0.6)`: un "bump" con pico en el umbral, de modo que `low(0.29) = 0.967 > low(0.1) = 0.333` — el valor **marginal** pesaba más como "bajo" que el valor **claramente bajo**. El conjunto `medium` compartía el mismo pico (0.3). Y los conjuntos de salida `medium` y `high` centroideaban exactamente en las fronteras de sus buckets (0.5 y 0.75), haciendo que un "Medium" o "High" aislado cayeran en el bucket vecino.

**D. Feature no robusta — `trajectory_complexity`.** La variable `complexity = waypoints / duration` resultó depender de la **densidad de interpolación**: en planes sintéticos cortos (10 waypoints / 20 s → 0.5) la escala era razonable, pero la pipeline real interpola densamente (392 waypoints / 3.9 s → ≈ 100), saturando el conjunto "high" y disparando la regla `R06` (Medium) **siempre**. Una propiedad de la discretización temporal/espacial se confundía con una propiedad semántica de la trayectoria.

### 4.4 Recalibración de la base de conocimiento

Con los escenarios de aceptación como criterio, se recalibró la KB:

| Cambio | Antes | Después |
|---|---|---|
| `R09_near_singularity` | sin efecto sobre el riesgo | `RiskIs High` — la singularidad cercana contribuye |
| `R07_low_manipulability` | derivaba `danger_zone` (colisión) | deriva su propio hecho `low_manipulability` + `RiskIs High` |
| `R11` | `danger_zone AND low → Critical` (colapso) | `low_manipulability AND near_singularity → Critical` — combinación real |
| `low` (entrada) | `Triangular(0, 0.3, 0.6)` (invertido) | `LeftShoulder(0 → 0.3)` — monótono decreciente |
| `medium` (entrada) | `Triangular(0.15, 0.3, 0.6)` (mismo pico que `low`) | `Triangular(0.15, 0.3, 0.5)` |
| `high` (entrada) | `Triangular(0.3, 0.6, 1.0)` (bump que decrece arriba) | `RightShoulder(0.5 → 0.7)` — monótono creciente |
| salida `medium` | centroide 0.5 (frontera Medium/High) | centroide 0.375 (dentro de Medium) |
| salida `high` | centroide 0.75 (frontera High/Critical) | centroide 0.625 (dentro de High) |

El criterio de diseño fue que cada conjunto de salida **centroidee dentro de su bucket** y cada conjunto de entrada sea **monótono donde corresponde**: la etiqueta de un conjunto pierde significado si su centro cae en la frontera del bucket.

### 4.5 Validación de frontera

Se añadieron tests de **vecinos** (no solo anclas): puntos alrededor de las fronteras relevantes deben producir veredictos estables y sin discontinuidades escondidas.

| Vecinos | Veredicto esperado |
|---|---|
| manipulabilidad 0.28 / 0.29 / 0.30 / 0.31 | Medium (estable) |
| manipulabilidad 0.05 / 0.10 / 0.15 | High (estable) |
| proximidad 0.25 / 0.30 / 0.35 | High (estable) |
| proximidad 0.05 | Low |

### 4.6 Integración con el pipeline real

Se construyó una **demostración standalone** que atraviesa el pipeline completo con trayectorias reales (sin mocks, sin fixtures artificiales):

```
cargo test -p thalos-planning --test assessment_demo -- --nocapture
```

**Descubrimiento — pérdida de evidencia local.** En una trayectoria real que cruza la extensión completa del robot, el analizador detecta **13 observaciones de singularidad** (12 near-singular + 1 singular). Sin embargo, el `Assessor` v1 veredictaba **Low**:

```
singularity_proximity = (12 + 1) / 392 waypoints = 0.033  (diluido)
avg_manipulability    = 0.458  (el cruce es localizado; la media lo oculta)
```

Un fenómeno geométrico real quedaba reducido a una fracción casi nula. Esta es la pregunta científica que el trabajo responde experimentalmente: **¿las métricas agregadas preservan los eventos locales relevantes para la evaluación inteligente? Para las señales de singularidad, no.**

### 4.7 Rediseño de la representación de entrada (v2)

El `Assessor` se mantuvo como evaluador global, pero su representación de entrada incorpora **evidencia local canónica**:

- `localized_singularity` se deriva de las **observaciones** del analizador (presencia/severidad: 0 = ausente, 0.15 = solo near, 0.5 = evento singular), invariante a la densidad de interpolación. Con fallback a la fracción para reportes métricos (compatibilidad).
- `trajectory_complexity` se **eliminó** (variable + regla): la feature medía densidad de interpolación, no complejidad semántica — no es robusta ante una transformación operacionalmente irrelevante (misma trayectoria, más interpolación, mayor "complejidad").
- `min_manipulability` se consideró como evidencia local de manipulabilidad, pero se **excluyó deliberadamente**: el analizador ya emite observaciones `LowManipulability` para dips localizados, y una segunda entrada de manipulabilidad duplicaría la señal sin un fallo demostrado. Queda documentado como extensión futura.

### 4.8 Segunda validación real

La misma trayectoria real, antes y después del rediseño:

| Métrica | v1 (agregados) | v2 (agregados + evidencia local) |
|---|---|---|
| `singularity score` | 0.033 (diluido) | 0.500 (observación real) |
| `avg_manipulability` | 0.458 | 0.458 (global, intacto) |
| **Veredicto** | **Low (0.248)** | **High (0.557)** — R09 dispara |

El cambio se validó sin fabricar el caso: la trayectoria realmente produjo `singular_count = 1`.

---

## 5. Resultados

### 5.1 Escenarios controlados (KB congelada)

| Escenario | Riesgo crisp | Veredicto |
|---|---|---|
| Trayectoria saludable | 0.147 | Low |
| Manipulabilidad marginal (0.29) | 0.391 | Medium |
| Manipulabilidad claramente baja (0.1) | 0.625 | High |
| Solo singularidad cercana (prox 0.9) | 0.625 | High |
| Baja manipulabilidad + singularidad | 0.771 | Critical |
| Clearance crítico (−0.1) | 0.917 | Critical |
| Triple degradación | 0.771 | Critical |

Nota: la combinación `R07 → low_manipulability` y `R09 → near_singularity` habilita posteriormente `R11 → Critical`: dos reglas previas establecen hechos independientes que una tercera combina. *Critical* no es consecuencia directa de una sola métrica; requiere evidencia compatible. Esto se demuestra en escenarios controlados. En trayectorias Scara reales, la manipulabilidad baja y la singularidad cercana rara vez coexisten (la región de baja manipulabilidad tiene condición < 100; la señal de near-singularidad exige condición > 100). El sistema no produce *Critical* artificialmente en datos reales: la singularidad localizada eleva a *High*, y *Critical* requiere evidencia combinada.

### 5.2 Integración real (demo standalone)

| Escenario real | Observaciones | Evidencia local | Veredicto | Calidad |
|---|---|---|---|---|
| Saludable (mismo codo) | 0 | score 0.0 | Low (0.147) | 0.853 |
| Cruce de extensión | 13 (12 near + 1 singular) | score 0.5 → R09 | High (0.557) | 0.443 |

El escenario saludable demuestra **razonamiento positivo** (R08 `safe_clearance` → R10 `good_manipulability` → R12 `safe_plan`), no solo detección de fallos.

### 5.3 Separación explícita: `health` (analizador) vs `quality` (assessor)

En la trayectoria degradada conviven dos métricas con significados distintos:

- `health = 0.00 (Poor)`: score canónico del analizador, **penalización estricta por conteo de fallos** (13 errores → satura a 0).
- `quality = 0.443`: evaluación gradual derivada del riesgo difuso (`quality = 1 − risk`). El valor 0.557 es el **nivel crisp de riesgo** producido por la inferencia difusa — un grado derivado de la composición de evidencia, **no una probabilidad estadística de fallo**.

No hay contradicción: son métricas de naturaleza diferente. La del analizador es un gate estricto; la del assessor es un razonamiento suave y explicable. El demo las muestra juntas para que la diferencia sea explícita.

### 5.4 Batería de regresión

| Suite | Resultado |
|---|---|
| `thalos-intelligence` (unit + aceptación + goldens) | 59 + 3 + 8 ✓ |
| `thalos-planning` (demo + contrato + usabilidad) | 2 + 4 + 10 ✓ |
| `thalos_runtime` | 290 ✓ |
| `thalos_api` (api_tests) | 95 ✓ |

---

## 6. Discusión

**Ingeniería vs. implementación.** El valor del trabajo no es "implementamos Mamdani": es el ciclo experimental que lo respalda. Cada corrección responde a una evidencia observada, no a un ajuste por intuición. La evolución de la KB se presenta como metodología: la primera versión fue auditada con escenarios controlados y una prueba de integración real; esos experimentos revelaron inconsistencias que las pruebas aisladas no mostraban.

**El descubrimiento de `trajectory_complexity` es el mejor ejemplo de no aceptar features ciegamente.** Una variable aparentemente razonable resultó dependiente de la discretización y, por tanto, no representaba una propiedad semántica estable. Se eliminó en lugar de "mover el umbral hasta que quedara bonito". Principio general: **una mala representación no se arregla necesariamente calibrando el modelo** — cuando una feature no representa el fenómeno, el ajuste de umbrales es cosmético; la corrección está en la representación.

**Decisiones de diseño explícitas.** `min_manipulability` no alimenta Mamdani por una razón arquitectónica documentada; `health` y `quality` son métricas distintas por diseño; el `Assessor` es global y el `PlanAdvisor` local — la separación se conserva.

---

## 7. Conclusiones

1. Thalos ya posee una capa de IA clásica funcional: un sistema experto difuso que interpreta el informe de análisis del pipeline real.
2. La calibración de una base de conocimiento es un proceso experimental, no un evento único: requiere escenarios de aceptación, auditoría y validación de frontera.
3. La integración con el pipeline real es indispensable: reveló una pérdida de evidencia local que los tests aislados no detectaban.
4. La representación de entrada importa tanto como las reglas: una feature no robusta (densidad de interpolación) se eliminó; la evidencia local se incorporó desde las observaciones canónicas.
5. El componente resultante produce decisiones inteligentes diferentes debido a evidencia geométrica real, con una traza que explica por qué.

---

## 8. Reproducibilidad

```text
# Batería completa del componente inteligente
cargo test -p thalos-intelligence -- --nocapture

# Demo standalone: trayectoria real → analyzer real → Assessor (narrativa de 8 secciones)
cargo test -p thalos-planning --test assessment_demo -- --nocapture

# Contrato de calidad + usabilidad (pipeline real)
cargo test -p thalos-planning --test quality_contract_properties --test usability_intelligence

# Consumidores
cargo test -p thalos_runtime
cargo test -p thalos_api --test api_tests
```

Archivos relevantes: `backend/crates/thalos-intelligence/src/{lib,kb,fuzzy,engine,output}.rs`, `backend/crates/thalos-intelligence/tests/{acceptance_scenarios,golden}.rs`, `backend/crates/thalos-planning/tests/assessment_demo.rs`.

---

## 9. Trabajo futuro

- **Manipulabilidad localizada**: incorporar `LowManipulability` observaciones como evidencia local (misma técnica que singularidad), cuando un fallo demostrado lo justifique.
- **Evaluación de la interfaz**: el componente está congelado; resta auditar si la UI comunica las afirmaciones de este informe (razonamiento, traza, distinción health/quality).
- **Narrativa de defensa**: extraer de este informe una presentación de 3–5 minutos centrada en el ciclo experimental y el hallazgo de integración.
