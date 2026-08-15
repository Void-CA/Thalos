# Narrativa de defensa — 5 minutos

## Evaluación Inteligente de Trayectorias Robóticas (Thalos)

**Objetivo:** demostrar que implementamos técnicas de **IA clásica** —lógica difusa y sistemas expertos— para convertir evidencia geométrica real en una evaluación explicable de riesgo, y que esa evaluación **no se queda en un veredicto**: el sistema sintetiza alternativas de movimiento, las compara y selecciona la mejor con una razón derivada. No vendemos "Thalos tiene IA": mostramos mecanismos concretos (representación del conocimiento, funciones de pertenencia, inferencia Mamdani, encadenamiento hacia adelante, generación acotada de candidatos, selección por costo objetivo y traza completa).

**Regla de oro:** nunca mostrar solo `Risk: High, Quality: 44.3%`. Mostrar el **razonamiento** y la **comparación de alternativas**. Por eso el demo vive en el pipeline real: `cargo test -p thalos-planning --test candidate_counterfactual -- --nocapture` imprime la tabla rankeada, y el panel web (Intelligence tab → Candidate Alternatives) la presenta sobre el wire real.

---

## 0:00 – 0:35 · Problema

> "Thalos ya analizaba una trayectoria y detectaba singularidades, manipulabilidad y colisiones. El problema era doble: esas señales no producían una evaluación explicable de riesgo, y aunque el plan fuera riesgoso, el sistema no proponía nada mejor — diagnosticaba, pero no exploraba alternativas."

Una frase, sin tecnicismos. El problema es la falta de una capa de interpretación **y** de síntesis.

---

## 0:35 – 1:10 · Detect

Mostrar el pipeline de detección (una vez, sin repetir):

```text
Motion Program
   ↓
Analyzer (FK, Jacobiano, singularidad, manipulabilidad, colisiones)
   ↓
AnalysisReport  (observaciones canónicas + métricas agregadas)
```

Explicar **una sola vez** cada capa:

- **Analyzer**: evalúa cada waypoint (SVD del Jacobiano, distancia de colisión, Yoshikawa). Emite observaciones canónicas machine-readable (`NearSingularity`, `LowManipulability`…), ancladas a waypoints — no texto.
- **Clave**: la evidencia distingue **global** (promedios) de **local** (fenómenos que el promedio diluiría).

---

## 1:10 – 1:50 · Explain

Mostrar el pipeline de evaluación (la pantalla del Intelligence tab):

```text
Fuzzy Inputs (global: avg manipulability · local: clearance, singularidad)
   ↓
Mamdani + Expert System
   ↓
Risk / Quality / Trace
```

- **Mamdani (difusa)**: las señales continuas se convierten en grados lingüísticos (p. ej. `manipulability medium = 0.21`), las reglas los combinan y un centroide produce el riesgo crisp en [0, 1].
- **Sistema experto**: reglas con prioridad, encadenamiento hacia adelante y hechos derivados — no es una lista de umbrales.

Caso real del demo (cruce de extensión — el analyzer detecta el evento):

```text
singular_count     = 2 (de 26 waypoints)
localized_singularity = 0.5
R09 → RiskIs High
→ High · crisp risk 0.557 · quality 0.443
```

> "Aquí el jurado ya ve el mecanismo: la traza explica por qué el veredicto es High."

**El descubrimiento (momento de ingeniería):** la primera implementación diluía la singularidad local en un promedio (`13/392 waypoints → 0.033 → Low`). La evidencia local debe venir de las observaciones canónicas, no de una fracción. Una mala representación no se arregla calibrando el modelo.

---

## 1:50 – 2:40 · Generate + Compare

> "El veredicto High dice que el plan directo es riesgoso. Pero un diagnóstico no es una solución. Thalos no se queda ahí: genera realizaciones alternativas del MISMO programa —misma tarea, mismos endpoints— y las evalúa con el mismo pipeline."

Mostrar la **pantalla de arquitectura**:

```text
Motion Program
   ↓
Candidate Generator (biblioteca acotada de estrategias)
   ├── Direct          (el seed, baseline inmutable)
   ├── InsertWaypoint  (skipped: UnsupportedSegment)
   └── AlternateElbow  (re-solve del segmento al codo del mismo lado)
   ↓
Analyzer → Fuzzy + Expert Assessor   (mismo pipeline por candidato)
   ↓
Admissibility gate (invariantes: endpoints ε + identidad de tarea + política de riesgo)
   ↓
Objective ranking (costo J = Σ wᵢ·normᵢ)
```

Mostrar la tabla comparativa del demo real (el Intelligence tab → **Alternative Synthesis**):

```text
strategy         risk    quality  singular  dur(s)  manip   cost   status
Direct          0.5571   0.4429      2      7.818  0.4585  1.0000 Generated
AlternateElbow  0.1625   0.8375      0      5.256  0.6314  0.0000 Generated
InsertWaypoint      —       —        —        —      —       —   Skipped (Unsupported segment)
```

Puntos clave:

- El **strategy trace** muestra qué generó cada estrategia y por qué se saltó (`UnsupportedSegment`, `IkFailed`, `InvariantViolation`).
- La **calidad mostrada es `1 − riesgo`** (proyección de la misma evaluación), etiquetada "Assessed quality" — el wire no la transporta, la pantalla la proyecta.
- La tabla es **wire-driven**: la UI nunca recalcula riesgo ni costo; el backend es la única autoridad.

---

## 2:40 – 3:15 · Select (MOMENTO CENTRAL)

> "La selección no es un número mágico: es el argmin del costo objetivo J sobre el conjunto admisible, y la razón se DERIVA de la comparación de métricas contra el baseline Direct — nunca texto escrito a mano, nunca un LLM."

Mostrar la conclusión (**Selection** — una conclusión distinta, no solo una fila resaltada):

```text
SELECTED: AlternateElbow — risk 0.1625 vs 0.5571 (Direct)
  risk: 0.1625 vs 0.5571 | duration: 5.2556 vs 7.8179
  manipulability: 0.6314 vs 0.4585 | length: 2.1398 vs 3.8850
  cost: 0.0000 vs 1.0000
  Endpoints: preserved · Task: preserved
```

Frase de cierre del bloque:

> "El mismo programa, misma tarea, mismos endpoints — pero el codo del mismo lado evita cruzar la extensión completa. El Assessor evalúa el cruce como High (0.557) y la realización alternativa como Low (0.1625). La selección es la consecuencia matemática de esa diferencia."

---

## 3:15 – 4:00 · Visualize / concluir

Mostrar la **pantalla web completa** (Intelligence tab):

1. **Intelligent Assessment** (veredicto + factores + traza — el jurado ya la conoce).
2. **Alternative Synthesis** (tabla comparativa + strategy trace).
3. **Selection** (conclusión derivada, con la comparación métrica y las invariantes).

Cerrar con la tesis:

> "El resultado no es un modelo que produce una etiqueta. Es un sistema de IA clásica que recibe evidencia geométrica real, la interpreta con conocimiento explícito e inferencia difusa, **sintetiza y evalúa realizaciones alternativas del mismo plan, y selecciona la mejor con una razón derivada y trazable** — del veredicto a la decisión."

---

## 4:00 – 5:00 · Qué aprendimos + preguntas

Lecciones que la auditoría de escenarios controlados reveló:

```text
low(0.29) > low(0.10)   ← la membresía "low" estaba invertida (pico en el umbral)
0.033 vs 0.500          ← la evidencia local se diluía en el promedio
marginal → Critical     ← una regla colapsaba "manipulabilidad baja" en riesgo máximo
```

Y el cierre:

> "No ajustamos umbrales hasta que quedara bonito. Revisamos la representación y probamos cada decisión con escenarios de aceptación explícitos. La selección de alternativas sigue el mismo estándar: invariantes demostradas (endpoints ε, identidad de tarea), razón derivada y un counterfactual reproducible en el pipeline real."

---

## Consejos de defensa

1. **No digas "55.7 % de probabilidad de fallo".** El riesgo crisp es un grado de la inferencia difusa, no una probabilidad estadística.
2. **Si preguntan "¿dónde está la inteligencia?"**: en los mecanismos — representación del conocimiento, membresías, Mamdani, encadenamiento, hechos derivados, síntesis acotada de candidatos, gate de admisibilidad y selección por objetivo con razón derivada.
3. **Si preguntan por health vs quality**: son métricas distintas por diseño — `health` es el score estricto del analizador (penalización por conteo de fallos), `quality` es la interpretación difusa gradual. No hay contradicción.
4. **Corre el demo en vivo si se puede**: `cargo test -p thalos-planning --test candidate_counterfactual -- --nocapture` (tabla rankeada) y el panel web con la escena demo `scara-pick-place-home` (Pick → Wait → Place → Home con cruce de segmento medio).
5. **Si preguntan "¿por qué la UI no calcula la calidad/el riesgo?"**: la pantalla es display-only — el wire es autoritativo. La única proyección es `Assessed quality = 1 − riesgo`, etiquetada como tal.

---

## Posibles preguntas del jurado

| Pregunta | Respuesta corta |
|---|---|
| ¿Por qué no ML? | La asignatura contempla IA clásica; ML no era aconsejado. La técnica elegida (experto + difuso) da trazabilidad completa, que ML no garantiza con datos escasos. |
| ¿Cómo se calibraron las membresías? | Con escenarios de aceptación explícitos (tabla de expectativas) + tests de vecinos en las fronteras; no por ajuste visual. |
| ¿El `Assessor` y el `PlanAdvisor` no se pisan? | No: el Assessor evalúa riesgo global (no muta, no repara); el PlanAdvisor produce reparaciones; el Candidate Generator sintetiza alternativas y el evaluador las rankea. Separación de roles explícita. |
| ¿Cómo se elige el segmento objetivo? | Es una política SEPARADA de la estrategia: el MVP apunta al primer segmento; la selección por región problemática más severa es follow-up documentado (el counterfactual usa el segmento medio del cruce). |
| ¿La selección es un LLM? | No: `argmin J` sobre el conjunto admisible + razón derivada de la comparación de métricas contra el baseline Direct. Estructura, nunca narrativa inventada. |
| ¿Dónde está la base de conocimiento? | `backend/crates/thalos-intelligence/src/kb.rs` — 11 reglas, 3 variables lingüísticas, ancladas a los umbrales del analizador con tests de anclaje. |
