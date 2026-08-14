# Presentación IA — "¿Cómo decide Thalos?"

> **Audiencia**: jurado de defensa / evaluación del proyecto de IA. **Propósito**: demostrar que Thalos toma decisiones
> trazables sobre evidencia geométrica real — no que "tiene IA". **Relación**: esta narrativa refina y reemplaza como guía
> principal a `docs/deliverables/presentations/narrativa-defensa.md` (que conserva el cronograma y el Q&A del jurado). **Contraparte**:
> `docs/deliverables/presentations/robotica-como-funciona.md` — la misma plataforma leída desde la robótica.

---

## Tesis central

> Thalos no usa IA para generar código ni para controlar el robot. Usa métodos de IA clásica sobre evidencia geométrica
> producida por el sistema para analizar realizaciones, generar alternativas y seleccionar la más conveniente de forma
> trazable.

Trampa a evitar: vender Thalos como "un robot con IA". No es eso. Es un sistema de decisión clásico cuyo **input es la
salida del pipeline real**, no datos sintéticos ni sugerencias de un LLM.

---

## 1. El problema: "válido" no significa "bueno"

Programar un movimiento no termina cuando encontramos una trayectoria válida. La misma tarea admite múltiples
realizaciones con distinta:

- manipulabilidad;
- proximidad a singularidades;
- riesgo;
- margen de restricciones;
- calidad geométrica;
- duración.

> **"Válido" ≠ "bueno".**

Ese gap — entre cumplir la tarea y cumplirla bien — es lo que justifica el componente inteligente.

---

## 2. La evidencia: decisiones sobre datos del pipeline, no inventados

Mostrar el pipeline real:

```text
Task → IR (instrucciones) → constraints → IK → planning → analysis
```

El sistema **no** decide sobre datos fabricados. Lee del propio pipeline:

- poses y frames;
- Jacobiano (analítico y numérico, validación cruzada);
- manipulabilidad (índice de Yoshikawa);
- proximidad a singularidades (número de condición);
- colisiones (SAT / OBB);
- límites articulares;
- duración y geometría de la trayectoria.

Mecanismos (mencionar por nombre, con una línea cada uno):

- **Sistema experto con encadenamiento hacia adelante** — base de reglas
congelada de 11 reglas, antecedentes tipados, consecuentes (`DeriveFact`, `MarkEvidence`, `RiskIs`).
- **Capa difusa Mamdani** — 3 variables lingüísticas (manipulabilidad,
proximidad a singularidad, clearance de colisión) → veredicto `Low | Medium | High | Critical`.
- **Separación hecho / recomendación** — el análisis emite hechos objetivos;
la recomendación es una capa distinta. El `Assessor` es global; el `PlanAdvisor` local.

Esto es lo que lo diferencia de un LLM que "sugiere": acá no hay sugerencia, hay **inferencia sobre evidencia**.

---

## 3. El caso central: la realización alternativa

Escenario real (fixture `crossing-pick-place-home`, pipeline completo sin mocks). El programa cruza la extensión
completa del brazo; la línea recta en joint space pasa por una singularidad localizada.

| Realización | Risk | Quality | Waypoints singulares | Duración (s) | Estado |
|-------------|------|---------|----------------------|--------------|--------|
| Direct | **0.5571** | 0.4429 | 2 | 7.818 | admissible |
| AlternateElbow | **0.1625** | 0.8375 | 0 | 5.256 | admissible |

```text
SELECTED: AlternateElbow — risk 0.1625 vs 0.5571 | endpoints/task preserved | reason derived
```

No presentar como: *"la IA encontró una trayectoria mejor"* (superficial).

La frase correcta:

> **"El sistema encontró una realización alternativa porque la evidencia geométrica mostraba que la primera era menos
> favorable."**

El camino mostrado:

```text
Analyze → Advise → Explain → Optimize → Select
```

- **Analyze**: la trayectoria cruza extensión completa → 2 waypoints
singulares + near-singularities.
- **Advise**: la regla R09 eleva el riesgo a **High (0.557)**.
- **Explain**: calidad normalizada 0.443, `quality = 1 − risk`, traza auditable.
- **Optimize**: generador acotado de candidatos (perturbación determinista
sobre los waypoints problemáticos) → AlternateElbow.
- **Select**: gate de admisibilidad + `argmin J` sobre el conjunto admisible.

La selección deja de ser una caja negra: **es la consecuencia matemática de una diferencia medible**, no una opinión del
modelo.

---

## 4. El momento de defensa: "¿Cómo llegó Thalos a esa decisión?"

Plantear la pregunta deliberadamente y reconstruirla delante del jurado:

1. **Evidencia**: la trayectoria Direct cruza la extensión completa; el
análisis produce observaciones canónicas (singularidad localizada).
2. **Interpretación**: Mamdani + reglas → `RiskIs High` (0.557),
`quality = 0.443`.
3. **Alternativas**: generador acotado → AlternateElbow; el mismo programa,
misma tarea, mismos endpoints — distinta configuración del codo.
4. **Evaluación**: cada candidato pasa por el pipeline completo → la
alternativa produce riesgo 0.1625, 0 waypoints singulares, menor duración.
5. **Política**: gate de admisibilidad + `argmin J` → `J_selected ≤ J_direct`.
6. **Traza**: cada paso registrado (origen de operación, evidencia, reglas
disparadas) — reconstruible.

NO responder: *"porque el modelo dijo que era mejor"*. SÍ responder: *"porque esta realización produjo estas métricas,
presentó este riesgo, la alternativa produjo estos valores, y el policy/gate permitió seleccionarla"*.

> El componente IA queda como **razonamiento reproducible**, no como oráculo.

---

## 5. El papel de la UI: `approach_height` como evidencia de diseño

No presentar el fix como feature. Usarlo como prueba de una propiedad de diseño:

> **Toda decisión o parámetro significativo del sistema debe tener una consecuencia observable en el modelo, la
> trayectoria o la ejecución.**

Demo en vivo:

```text
approach_height = 20 mm  →  approach frame bajo  →  descenso corto  →  visualización
approach_height = 50 mm  →  approach frame alto  →  trayectoria más alta  →  visible
approach_height = 100 mm →  approach frame más alto →  trayectoria evidente →  visible
```

Los markers semitransparentes de approach/retreat en el viewport muestran el modelo geométrico que Thalos está usando:
el parámetro **causa** el cambio visible — no es un control decorativo.

Cadena de causalidad demostrable:

```text
Usuario → approach_height → SceneDocument → SceneKnowledge → approach frame
        → planned trajectory → viewport
```

Cambias a 50 mm y el encadenamiento completo responde. Eso demuestra **coherencia entre intención, representación,
planificación y visualización** — y que las decisiones del sistema no viven únicamente dentro de Rust.

> Esto refuerza la narrativa de IA: el mismo principio de trazabilidad que hace reconstruible la decisión (Select) hace
> reconstruible el modelo (UI).

---

## 6. Mensaje final

> Thalos demuestra que métodos de IA clásica pueden utilizar evidencia geométrica real del pipeline robótico para analizar
> alternativas y tomar decisiones trazables sobre su calidad, en lugar de limitarse a producir una solución válida.

Y, cerrando la pareja con la presentación de robótica:

> **"El objetivo no es ocultar la complejidad del robot, sino hacerla explícita, analizable y trazable."**

---

## Anexo A — Datos duros verificados (citar con fuente)

| Dato | Valor | Fuente |
|------|-------|--------|
| Direct risk / quality | 0.5571 / 0.4429 | `docs/deliverables/presentations/narrativa-defensa.md`, `docs/execution/demos/demo-scenarios.md` |
| AlternateElbow risk / quality | 0.1625 / 0.8375 | ídem |
| Waypoints singulares | Direct 2 (de 26) vs AlternateElbow 0 | `narrativa-defensa.md:56` |
| Duración | 7.818 s vs 5.256 s | `narrativa-defensa.md:94,114` |
| Regla disparada | R09 → RiskIs High | `informe-ia.md:205,232` |
| Calidad | `quality = 1 − risk` (grado, no probabilidad) | `informe-ia.md:241` |
| Base de reglas | 11 reglas congeladas, forward chaining | `informe-ia.md:41,44` |
| Variables lingüísticas | 3 (manipulabilidad, singularidad, colisión) | `informe-ia.md:50-55` |
| Selección | `argmin J` sobre el conjunto admisible, `J_selected ≤ J_direct` | `demo-scenarios.md:68` |
| Fixture | `crossing-pick-place-home`, pipeline real sin mocks | `demo-scenarios.md` |
| Selectividad | `healthy-pick-place-home`: Direct ya es la mejor → NO inventa alternativa | `demo-scenarios.md:101-103` |
| Honestidad | `single-segment-crossing`: generador dice "Skipped", no inventa | `demo-scenarios.md` |

## Anexo B — Frases y trampas

- **Usar**: "realización", "evidencia", "traza", "admisibilidad", "argmin J".
- **Evitar**: "la IA mejoró la trayectoria", "el modelo aprendió", "red
neuronal", "sugerencia".
- Si preguntan por qué no ML: la decisión debe ser **reconstruible y
verificable**; el conocimiento es explícito (reglas + pertenencia), no implícito en pesos.
- Si preguntan si la selección usa un LLM: **No** — `argmin J` con razón
derivada de la comparación de métricas contra el baseline.
- Nunca mostrar solo `Risk: High, Quality: 44.3%` — siempre el razonamiento y
la comparación de alternativas (golden rule de `narrativa-defensa.md`).
