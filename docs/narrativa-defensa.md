# Narrativa de defensa — 5 minutos

## Evaluación Inteligente de Trayectorias Robóticas (Thalos)

**Objetivo:** demostrar que implementamos técnicas de **IA clásica** —lógica difusa y sistemas expertos— para convertir evidencia geométrica real en una evaluación explicable de riesgo. No vendemos "Thalos tiene IA": mostramos mecanismos concretos (representación del conocimiento, funciones de pertenencia, inferencia Mamdani, encadenamiento hacia adelante, combinación de evidencia, traza).

**Regla de oro:** nunca mostrar solo `Risk: High, Quality: 44.3%`. Mostrar el **razonamiento**. Por eso existe el demo standalone: `cargo test -p thalos-planning --test assessment_demo -- --nocapture`.

---

## 0:00 – 0:40 · Problema

> "Thalos ya podía analizar una trayectoria y detectar singularidades, manipulabilidad y colisiones. El problema era que esas señales no producían una evaluación explicable de riesgo: el pipeline detectaba y clasificaba fenómenos, pero nada los integraba en un veredicto gradual."

Una frase, sin tecnicismos. El problema es la falta de una capa de interpretación, no la falta de detección.

---

## 0:40 – 1:20 · Solución

Mostrar el pipeline (una vez, sin repetir):

```text
Analyzer
   ↓
AnalysisReport        (métricas agregadas + observaciones canónicas)
   ↓
Fuzzy Inputs          (global: avg manipulability · local: clearance, singularidad)
   ↓
Mamdani + Expert System
   ↓
Risk / Quality / Trace
```

Explicar **una sola vez** cada capa:

- **Mamdani (difusa)**: las señales continuas se convierten en grados lingüísticos (p. ej. `manipulability medium = 0.21`), las reglas los combinan y un centroide produce el riesgo crisp en [0, 1].
- **Sistema experto**: reglas con prioridad, encadenamiento hacia adelante y hechos derivados — no es una lista de umbrales; las reglas establecen hechos que otras reglas consumen.
- **Clave**: la entrada distingue evidencia **global** (promedios) de **local** (fenómenos que el promedio diluiría).

---

## 1:20 – 2:00 · Cómo razona

Dos casos reales, mostrados en el demo.

**Saludable** (razonamiento positivo — el sistema no solo detecta fallos):

```text
manipulability = 0.77 (high)
singularity    = low
clearance      = safe

R08 → safe_clearance
R10 → good_manipulability
R12 → RiskIs Low

→ Low, quality 0.853
```

**Degradado** (cruce de extensión — el analyzer detecta el evento):

```text
singular_count     = 1
localized_singularity = 0.5
R09 → RiskIs High
→ High
```

Aquí el profesor ya entiende el mecanismo: las reglas disparan con evidencia real y la traza muestra por qué.

---

## 2:00 – 3:00 · El descubrimiento (MOMENTO CENTRAL)

> "La primera implementación parecía funcionar. Pero al conectarla al pipeline real descubrimos algo: una singularidad presente en 13 de 392 waypoints se convertía en una fracción de 0.033 — y prácticamente desaparecía. El sistema veredictaba Low sobre una trayectoria que el analyzer había marcado con 13 observaciones de singularidad."

Mostrar el antes/después de la MISMA trayectoria:

```text
v1:  singularity score = 0.033 (diluido por interpolación densa)  → Low
v2:  singularity score = 0.500 (desde las observaciones del analyzer) → High
```

Frase de cierre de este bloque:

> "Las métricas agregadas no preservaban los eventos locales. Rediseñamos la representación de entrada para que la evidencia local viniera de las observaciones canónicas del analizador, no de una fracción."

**Este es el punto que demuestra trabajo de ingeniería, no solo implementación.**

---

## 3:00 – 4:00 · Qué aprendimos

Mostrar brevemente otros defectos que la auditoría de escenarios controlados reveló — y la lección:

```text
low(0.29) > low(0.10)   ← la membresía "low" estaba invertida (pico en el umbral)
complexity = 100+       ← dependía de la densidad de interpolación, no de la trayectoria
marginal → Critical     ← una regla colapsaba "manipulabilidad baja" en riesgo máximo
```

Y la conclusión:

> "No ajustamos umbrales hasta que quedara bonito. Revisamos la representación: funciones de membresía monótonas donde corresponde, conjuntos de salida que centroidean dentro de su bucket, y una feature —`trajectory_complexity`— que eliminamos porque no representaba una propiedad semántica estable. Una mala representación no se arregla calibrando el modelo."

---

## 4:00 – 5:00 · Resultado

Cerrar con la tesis y mostrar la traza real:

> "El resultado no es un modelo que produce una etiqueta. Es un sistema de IA clásica que recibe evidencia geométrica real, combina conocimiento explícito con inferencia difusa, y puede explicar qué reglas llevaron a su decisión."

Mostrar la traza del demo (escenario degradado):

```text
[R05_manipulability_medium]  → risk Medium   (Manipulability IS medium → 0.210)
[R09_near_singularity]       → risk High     (SingularityProximity IS high → 1.000)
derived: near_singularity
→ crisp risk 0.557 · verdict High · quality 0.443
```

Cierre:

> "13 observaciones reales → evidencia local preservada → una regla dispara → el riesgo cambia. Y la traza explica exactamente por qué. Eso es lo que convierte un análisis en una decisión explicable."

---

## Consejos de defensa

1. **No digas "55.7 % de probabilidad de fallo".** El riesgo crisp es un grado de la inferencia difusa, no una probabilidad estadística.
2. **Si preguntan "¿dónde está la inteligencia?"**: está en los mecanismos — representación del conocimiento, membresías, Mamdani, encadenamiento, hechos derivados, combinación de evidencia, decisión y trazabilidad. IA clásica, contemplada explícitamente por la asignatura.
3. **Si preguntan por health 0.00 vs quality 0.443**: son métricas distintas por diseño — `health` es el score estricto del analizador (penalización por conteo de fallos), `quality` es la interpretación difusa gradual. No hay contradicción.
4. **Corre el demo en vivo si se puede** (`cargo test -p thalos-planning --test assessment_demo -- --nocapture`): el output de 8 secciones habla solo.

---

## Posibles preguntas del jurado

| Pregunta | Respuesta corta |
|---|---|
| ¿Por qué no ML? | La asignatura contempla IA clásica; ML no era aconsejado. La técnica elegida (experto + difuso) da trazabilidad completa, que ML no garantiza con datos escasos. |
| ¿Cómo se calibraron las membresías? | Con escenarios de aceptación explícitos (tabla de expectativas) + tests de vecinos en las fronteras; no por ajuste visual. |
| ¿El `Assessor` y el `PlanAdvisor` no se pisan? | No: el Assessor evalúa riesgo global (no muta, no repara); el PlanAdvisor produce reparaciones sobre observaciones. Separación de roles explícita. |
| ¿`min_manipulability` no debería alimentar Mamdani? | Se consideró y se excluyó deliberadamente: el analyzer ya emite `LowManipulability` observaciones para dips localizados; una segunda entrada duplicaría la señal sin un fallo demostrado. Extensión documentada. |
| ¿Dónde está la base de conocimiento? | `backend/crates/thalos-intelligence/src/kb.rs` — 11 reglas, 3 variables lingüísticas, ancladas a los umbrales del analizador con tests de anclaje. |
