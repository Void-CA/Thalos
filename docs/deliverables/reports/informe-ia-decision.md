# Evaluación y selección de realizaciones robóticas mediante Inteligencia Artificial clásica

## Un sistema experto difuso con toma de decisiones trazable sobre evidencia geométrica real

| Campo | Valor |
|---|---|
| Ámbito disciplinario | Inteligencia Artificial clásica: sistemas expertos, lógica difusa, inferencia Mamdani, toma de decisiones |
| Plataforma experimental | Thalos — planificación y análisis de movimiento robótico (SCARA R-R-P-R) |
| Alcance del informe | Modelo conceptual, diseño, metodología experimental y resultados del sistema de evaluación y selección |
| Estado | Método congelado; resultados verificados sobre el pipeline real de la plataforma experimental |
| Fuentes primarias | `docs/deliverables/reports/informe-ia.md`, `docs/execution/demos/demo-scenarios.md`, `docs/deliverables/presentations/ia-como-decide.md`, `docs/deliverables/presentations/narrativa-defensa.md` |

---

## 1. Introducción

En planificación robótica, encontrar una trayectoria admisible no garantiza que esta sea conveniente. Una misma tarea
puede admitir diferentes realizaciones —instanciaciones geométricas del mismo programa que conservan los mismos puntos
inicial y final— con niveles muy distintos de manipulabilidad, proximidad a singularidades, margen frente a colisiones y
costo de ejecución. Este trabajo aborda este problema mediante técnicas de Inteligencia Artificial (IA) clásica
orientadas a la evaluación y selección de realizaciones robóticas.

La pregunta que motiva el trabajo es doble. En primer lugar, dada la evidencia geométrica que describe una trayectoria,
¿cómo integrar señales de naturaleza distinta —manipulabilidad, singularidad, riesgo de colisión— en una evaluación de
riesgo gradual y explicable? En segundo lugar, cuando esa evaluación indica que el plan directo es desfavorable, ¿cómo
sintetizar realizaciones alternativas de la misma tarea, compararlas de forma objetiva y seleccionar la más conveniente
con una razón reconstruible?

La hipótesis del trabajo es que un enfoque de IA clásica —un sistema experto con encadenamiento hacia adelante combinado
con lógica difusa en el esquema de inferencia de Mamdani— puede convertir evidencia geométrica real en decisiones
trazables, sin depender de modelos de aprendizaje. La selección entre alternativas se formula como un problema de
decisión estructurado: restricción al conjunto de realizaciones admisibles y minimización de una función de costo
objetivo.

La experimentación se realiza sobre la plataforma Thalos, que proporciona las trayectorias y las métricas geométricas
que constituyen la evidencia del proceso de decisión. Thalos funciona exclusivamente como entorno experimental: su
pipeline produce los datos que alimentan el método y los escenarios de validación sobre los que se evalúa. El presente
informe describe el problema, los fundamentos, el diseño, la experimentación y los resultados del método; la plataforma
aparece únicamente como el contexto donde el método fue implementado y evaluado. Un anexo final de correspondencia con
la implementación permite verificar, fuera del cuerpo del informe, el vínculo entre cada concepto descrito y su
realización concreta.

El informe se organiza en once secciones: planteamiento del problema (sección 2), objetivos (sección 3), fundamentos
teóricos (sección 4), propuesta de solución (sección 5), metodología experimental (sección 6), resultados (sección 7),
discusión (sección 8), conclusiones (sección 9), trabajo futuro (sección 10) y referencias (sección 11).

---

## 2. Planteamiento del problema

### 2.1 Qué significa evaluar una realización

Programar un movimiento no termina cuando se encuentra una trayectoria válida. La misma tarea admite múltiples
realizaciones —instanciaciones geométricas del mismo programa, con los mismos endpoints— que difieren en cualidades que
el predicado de validez no captura:

- **manipulabilidad** de cada configuración a lo largo del camino;
- **proximidad a singularidades** (configuraciones donde el Jacobiano degenera);
- **riesgo** global de la trayectoria, entendido como un grado derivado de la composición de señales;
- **margen de restricciones** (clearance de colisión, distancia a los límites articulares);
- **calidad geométrica** (longitud, suavidad, forma de la trayectoria);
- **duración** de la ejecución.

Esta observación se resume en el principio que motiva el trabajo: **"válido" no significa "bueno"**. Un plan puede ser
completamente válido —alcanza los endpoints, respeta las restricciones, no colisiona— y sin embargo atravesar una
singularidad localizada, degradar la manipulabilidad o resultar más largo de lo necesario. Evaluar una realización
consiste, entonces, en determinar en qué grado la evidencia geométrica de esa realización indica condiciones
desfavorables.

### 2.2 Qué información considera el sistema

El sistema debe considerar dos clases de información sobre cada realización. Por una parte, **métricas agregadas** de
toda la trayectoria: manipulabilidad media, distancia mínima a obstáculos, conteo de waypoints cercanos a
singularidades, conteo de waypoints singulares, cantidad de waypoints y duración. Por otra parte, **observaciones
localizadas**: hechos tipados que describen fenómenos geométricos concretos —manipulabilidad baja, proximidad a una
singularidad, singularidad efectiva, riesgo de colisión— con severidad, ubicación dentro de la trayectoria y atributos
estructurados.

La distinción entre evidencia global y local es central. Las métricas agregadas pierden fenómenos localizados: un cruce
puntual de una singularidad queda reducido a una fracción casi nula cuando se promedia sobre toda la trayectoria. Un
sistema que evaluara solo con agregados ignoraría exactamente los eventos que más importan para el riesgo. El método
debe preservar ambas clases de señal para no evaluar sobre información empobrecida.

### 2.3 Selección entre alternativas

El problema de decisión es doble. Por una parte, las señales que describen la trayectoria no producían, por sí solas,
una evaluación explicable del riesgo: eran métricas y observaciones sin una capa de interpretación que las combinara.
Por otra parte, aun cuando un plan fuera riesgoso, no se proponía nada mejor: el sistema diagnosticaba, pero no
exploraba alternativas. El presente trabajo ataca ambos frentes: la interpretación (mediante sistema experto difuso) y
la síntesis (generación acotada de realizaciones alternativas, evaluación comparada y selección por un criterio
objetivo).

### 2.4 Requisitos de explicabilidad y trazabilidad

El sistema debe producir decisiones **reconstruibles y verificables**. Cada paso del razonamiento debe quedar
registrado: qué evidencia se consideró, cómo se interpretó y qué reglas se dispararon. La razón de una selección debe
ser la consecuencia matemática de una diferencia medible entre realizaciones, nunca un texto escrito a mano ni la salida
de un modelo generativo. Este requisito funcional es el que descarta, a priori, enfoques cuyo conocimiento queda
implícito en pesos y cuya decisión no es directamente inspeccionable.

---

## 3. Objetivos

### 3.1 Objetivo general

Diseñar e implementar un método de decisión que convierta la evidencia geométrica real producida por el pipeline
robótico en un veredicto de riesgo explicable y gradual y que, cuando el plan directo resulte desfavorable, sintetice
realizaciones alternativas del mismo programa y seleccione la más conveniente de forma trazable, empleando técnicas de
IA clásica: sistemas expertos, lógica difusa e inferencia Mamdani.

### 3.2 Objetivos específicos

1. **Construir un evaluador basado en evidencia**: una capa que integre las métricas agregadas y las observaciones localizadas en un riesgo gradual en [0, 1], con un veredicto categórico (Low / Medium / High / Critical) y una calidad normalizada, sin depender de modelos de aprendizaje.
2. **Generar alternativas acotadas**: un procedimiento determinista que opere sobre los waypoints problemáticos del plan directo mediante una biblioteca acotada de estrategias, preservando los endpoints y la tarea.
3. **Hacer la selección trazable**: un criterio de admisibilidad más una política de selección por costo objetivo (`argmin J`) sobre el conjunto admisible, con una razón derivada de la comparación de métricas contra la realización de referencia.
4. **Validar sobre el pipeline real**: garantizar que la entrada del método sea la salida del pipeline real (sin datos fabricados), que cada candidato atraviese el pipeline completo y que la integridad del proceso esté protegida por una garantía de completitud.

---

## 4. Fundamentos teóricos

### 4.1 Sistemas expertos y encadenamiento hacia adelante

Un sistema experto codifica conocimiento operacional en forma de reglas y razona sobre una memoria de trabajo de hechos
(Jackson, 1999). Este trabajo utiliza la variante clásica de **encadenamiento hacia adelante** (*forward chaining*): las
reglas se evalúan en una agenda ordenada por prioridad, una regla dispara cuando sus antecedentes se satisfacen contra
la memoria de trabajo, y los hechos derivados por una regla pueden habilitar reglas posteriores en pasos siguientes.

Los elementos del sistema experto utilizado son (`informe-ia.md`, §2.1):

- **Memoria de trabajo**: hechos derivados durante el razonamiento (manipulabilidad baja, proximidad a singularidad, clearance seguro, buena manipulabilidad, entre otros). Un hecho ausente cuenta como falso (supuesto de mundo cerrado).
- **Base de reglas**: 11 reglas en la versión congelada, cada una con una categoría temática (colisión, singularidad, manipulabilidad, trayectoria), una prioridad, antecedentes tipados (condiciones sobre métricas con grado difuso o sobre hechos booleanos) y consecuentes (derivar hechos, marcar evidencia, fijar nivel de riesgo).
- **Agenda**: las reglas se evalúan en orden descendente de prioridad; una regla dispara cuando **todos** sus antecedentes se cumplen (activación igual al mínimo de los grados difusos, semántica AND).
- **Encadenamiento**: los hechos derivados habilitan reglas posteriores; la composición de evidencia es un mecanismo real, no una lista de umbrales independientes.
- **Trazabilidad**: cada disparo registra la regla, su prioridad, las ligaduras de sus antecedentes y los hechos derivados, en el orden exacto de ejecución.

### 4.2 Lógica difusa e inferencia Mamdani

La lógica difusa, introducida por Zadeh (1965), permite representar y razonar con valores lingüísticos sobre variables
continuas. El controlador difuso de Mamdani y Assilian (1975) estableció el patrón de inferencia utilizado en este
trabajo: **fuzzificación** (grado de pertenencia de cada entrada crisp en conjuntos difusos), **reglas lingüísticas**
(antecedentes difusos → consecuente), **agregación** de contribuciones y **defuzzificación** del resultado.

Los elementos de la capa difusa utilizada son (`informe-ia.md`, §2.2):

- **Variables lingüísticas de entrada (3)**: manipulabilidad (baja / media / alta), proximidad a singularidad (baja / media / alta) y clearance de colisión (peligro / cercano / seguro).
- **Funciones de pertenencia**: hombros (izquierdo y derecho), triángulos y trapezoides, **ancladas a los umbrales físicos del analizador** mediante un contrato de anclaje verificado por pruebas: si la plataforma cambia sus umbrales físicos, la desviación se detecta antes de evaluar sobre valores inconsistentes.
- **Reglas Mamdani**: antecedentes difusos → consecuente de riesgo (Low / Medium / High / Critical).
- **Agregación**: máximo de las contribuciones activadas.
- **Defuzzificación**: centroide sobre muestras en [0, 1] → **riesgo crisp**.
- **Salidas**: categoría por umbrales — [0, .25) Low, [.25, .5) Medium, [.5, .75) High, [.75, 1] Critical — y `quality = 1 − riesgo crisp`. El riesgo crisp es un **grado derivado** de la inferencia difusa, no una probabilidad estadística de fallo (`informe-ia.md`, §5.3).

### 4.3 Toma de decisiones y optimización

La selección entre realizaciones se formula como un problema de decisión estructurado (Russell & Norvig, 2020). Dado un
conjunto de alternativas, se restringe primero a las **admisibles** mediante un criterio de invariantes —preservación de
endpoints y de tarea, política de riesgo— y, sobre ese conjunto, se minimiza una **función de costo objetivo** `J` sobre
métricas normalizadas de cada candidato. El criterio de selección es `argmin J`, con la garantía de que el costo de la
realización seleccionada no supera al de la realización de referencia. La razón de la selección se **deriva** de la
comparación de métricas entre candidatos, de modo que la decisión es el resultado de un criterio formal y no de una
valoración subjetiva.

### 4.4 Justificación de IA clásica frente al aprendizaje automático

La elección de IA clásica responde a un requisito funcional, no a una preferencia estética: la decisión debe ser
**reconstruible y verificable**. En un enfoque basado en aprendizaje, el conocimiento queda implícito en pesos y el
porqué de una decisión no es directamente inspeccionable; con datos escasos, el aprendizaje tampoco garantiza la
explicabilidad que exige un sistema de decisión auditado. En el enfoque clásico, el conocimiento es **explícito**
—reglas y funciones de pertenencia— y la decisión se reconstruye paso a paso a partir de la evidencia. Este es el
fundamento disciplinario de la propuesta: un razonamiento reproducible, no un oráculo.

---

## 5. Propuesta de solución

La solución propuesta consiste en un modelo de decisión capaz de transformar evidencia geométrica de una trayectoria en
una evaluación gradual de su calidad y, cuando sea necesario, comparar distintas realizaciones de una misma tarea. El
proceso comienza con la extracción de características relevantes de la trayectoria, entre ellas la manipulabilidad, la
proximidad a singularidades y el margen frente a colisiones. Estas características constituyen la evidencia sobre la
cual se aplica el conocimiento representado mediante reglas y conjuntos difusos.

### 5.1 Modelo conceptual

El método se modela como un proceso de decisión en siete etapas, independiente de la plataforma en la que se ejecuta:

```text
Evidencia geométrica → Representación de conocimiento → Inferencia → Evaluación de riesgo → Generación de alternativas → Evaluación de alternativas → Selección
```

1. **Evidencia geométrica**: las trayectorias y sus propiedades geométricas (manipulabilidad, singularidad, colisión, duración, longitud) provienen del pipeline real de la plataforma experimental.
2. **Representación de conocimiento**: la evidencia se estructura en observaciones localizadas y hechos derivados, y el conocimiento operacional se codifica en una base de reglas con funciones de pertenencia ancladas a umbrales físicamente significativos.
3. **Inferencia**: un sistema experto con encadenamiento hacia adelante combina la evidencia mediante reglas con prioridad, mientras que la capa difusa proyecta las variables continuas a grados lingüísticos.
4. **Evaluación de riesgo**: la inferencia produce un riesgo gradual en [0, 1], un veredicto categórico (Low / Medium / High / Critical) y una calidad normalizada (`quality = 1 − risk`).
5. **Generación de alternativas**: si la realización directa resulta desfavorable, un procedimiento determinista sintetiza realizaciones alternativas del mismo programa —misma tarea, mismos endpoints— mediante una biblioteca acotada de estrategias.
6. **Evaluación de alternativas**: cada candidato atraviesa el mismo proceso de evidencia, representación e inferencia que la realización directa; las métricas resultantes alimentan la función de costo objetivo.
7. **Selección**: un criterio de admisibilidad restringe el conjunto de candidatos y la política de costo objetivo (`argmin J`) elige la realización más conveniente, con una razón derivada de la comparación contra la realización de referencia.

### 5.2 Representación del conocimiento

La primera etapa de decisión corresponde a la interpretación de la evidencia. Un sistema experto mediante encadenamiento
hacia adelante permite combinar hechos y establecer conclusiones a partir de reglas explícitas, mientras que la lógica
difusa permite trabajar con fenómenos que no poseen fronteras estrictas, como una manipulabilidad baja o una proximidad
elevada a una singularidad. La combinación de ambos mecanismos produce un nivel de riesgo gradual, posteriormente
clasificado en categorías cualitativas.

La evidencia se organiza en dos clases de señal. La **señal global** resume toda la trayectoria mediante agregados como
la manipulabilidad media. La **señal local** preserva fenómenos que la agregación diluiría: el clearance de colisión se
toma como el mínimo de distancia a lo largo de la trayectoria —el peor clearance es el valor relevante para el riesgo de
colisión— y la singularidad localizada se obtiene de las observaciones tipadas del analizador, no de una fracción de
waypoints, porque una frecuencia agregada puede diluir un evento puntual.

La transformación de observaciones a señales se realiza en la capa de extracción, no en la base de conocimiento: la base
de reglas permanece genérica y no conoce la estructura interna de la plataforma. Esto preserva la separación entre el
conocimiento del método y el sistema que produce la evidencia.

La base de conocimiento congelada contiene **11 reglas** con encadenamiento hacia adelante, categoría temática,
prioridad, antecedentes tipados y consecuentes de derivación de hechos, marcado de evidencia y fijación de riesgo. La
agenda evalúa las reglas en orden descendente de prioridad; una regla dispara cuando todos sus antecedentes se cumplen,
con activación igual al mínimo de los grados difusos. Los hechos derivados por una regla habilitan reglas posteriores:
la composición de evidencia es un mecanismo real de encadenamiento, no una lista de umbrales independientes.

Las **3 variables lingüísticas de entrada** —manipulabilidad, proximidad a singularidad y clearance de colisión— se
definen con funciones de pertenencia (hombros, triángulos y trapezoides) ancladas a los umbrales físicos del analizador.
El diseño exige que cada conjunto de salida centre su defuzzificación dentro de su categoría y que cada conjunto de
entrada sea monótono donde corresponde: la etiqueta de un conjunto pierde significado si su centro cae en la frontera
del bucket.

### 5.3 Proceso de inferencia

La inferencia combina el sistema experto y la capa difusa Mamdani: fuzzificación de las entradas crisp, reglas
lingüísticas hacia el consecuente de riesgo, agregación por máximo y defuzzificación por centroide → **riesgo crisp**.
La salida incluye:

- **Veredicto categórico**: Low / Medium / High / Critical según los umbrales ([0, .25), [.25, .5), [.5, .75), [.75, 1]).
- **Calidad normalizada**: `quality = 1 − riesgo crisp`, proyección gradual de la misma evaluación.
- **Evidencia y traza**: observaciones consideradas, reglas disparadas en el orden exacto de ejecución y hechos derivados.

El riesgo crisp es un **grado derivado** de la composición de evidencia, no una probabilidad estadística de fallo. Esta
distinción es semántica y se mantiene en toda la comunicación del método.

### 5.4 Evaluación y selección de alternativas

Cuando una trayectoria presenta condiciones desfavorables, la solución no se limita a diagnosticar el problema, sino que
permite generar un conjunto acotado de realizaciones alternativas. Estas alternativas conservan la misma tarea y se
evalúan bajo los mismos criterios que la realización original, lo que permite realizar una comparación objetiva. La
selección final se formula como un problema de decisión sobre el conjunto de alternativas admisibles:

```text
c* = argmin_{c ∈ C_adm} J(c)
```

La selección combina dos elementos. Un **criterio de admisibilidad** exige que todo candidato preserve invariantes
—endpoints dentro de una tolerancia por articulación, identidad de tarea y política de riesgo—. Una **función de costo
objetivo `J`** combina linealmente métricas normalizadas de cada candidato, con un **desglose explicable**: cada término
de `J` corresponde a una métrica comparada contra la realización de referencia, de modo que la razón de la selección se
deriva de la comparación y no de una caja negra. El criterio de selección es `argmin J` sobre el conjunto admisible, con
la garantía `J_selected ≤ J_direct`.

De esta manera, la decisión no depende de una valoración subjetiva ni de una salida generada por un modelo de
aprendizaje, sino de la combinación de reglas explícitas, inferencia difusa y un criterio formal de selección.

La propuesta busca, por tanto, que una decisión pueda responder tres preguntas fundamentales: **qué evidencia fue
observada**, **cómo fue interpretada** y **por qué una alternativa fue seleccionada sobre las demás**. Esta propiedad de
trazabilidad constituye uno de los criterios principales utilizados posteriormente para evaluar la solución.

---

## 6. Metodología experimental

### 6.1 Diseño de escenarios

La validación se estructura en tres escenarios conceptuales que ejercitan las propiedades esenciales del método, cada
uno con un **contrato de invariantes** que verifica **categorías y comparaciones relativas, nunca números exactos como
aserción**: una recalibración que desplace un valor en un épsilon no debe invalidar la validación; solo una invariante
violada puede hacerlo. Los números aparecen como evidencia de referencia, no como contrato.

1. **Caso con trayectoria directa desfavorable**: la línea recta en el espacio articular cruza una región de mala condición (la extensión completa del robot), donde ocurre una singularidad localizada. El método debe evaluar la realización directa, sintetizar una realización alternativa de la misma tarea (una variante con configuración del codo) y seleccionarla. Invariantes: riesgo de la directa alto; al menos una alternativa admisible con riesgo estrictamente menor; selección distinta de la directa con costo no mayor; menos waypoints singulares en la seleccionada; endpoints y tarea preservados.

2. **Caso sano**: movimientos articulares pequeños en una región bien condicionada. La realización directa ya es la mejor. El método **no debe inventar una alternativa**: si ninguna candidata es admisible y estrictamente mejor, la selección coincide con la directa. Invariantes: riesgo de la directa bajo; ninguna alternativa admisible con riesgo menor; selección igual a la directa.

3. **Caso sin alternativa razonable**: un programa de un solo segmento, sobre el cual ninguna estrategia alternativa puede operar. El método debe declarar de forma honesta que la generación fue omitida, y conservar la realización directa. Invariantes: ninguna estrategia aplicable; generación omitida (estado categórico); selección igual a la directa.

Además, una **garantía de completitud** protege la honestidad del proceso: un escenario cuya entrada no puede compilar
(por ejemplo, targets articulares fuera de los límites del robot) debe fallar con el error real de la etapa
correspondiente, nunca degradar silenciosamente a un resultado categórico. Un proceso roto no puede parecer un resultado
válido de "no hay mejor alternativa".

La experimentación se realiza sobre el pipeline real de la plataforma, sin datos fabricados: los escenarios recorren
generación → compilación → análisis → evaluación → admisibilidad → selección con componentes reales sobre geometría
real. El método no evalúa sobre datos sintéticos: su entrada es la salida del pipeline real de la plataforma
experimental.

### 6.2 Validación del conocimiento

La base de conocimiento no fue escrita de una sola vez, sino sometida a un ciclo de **auditoría → detección de
inconsistencias → recalibración → validación de frontera → integración real** (`informe-ia.md`, §4). El método es
explícito: **la evolución de la base de conocimiento se guía por evidencia observada, no por intuición ni por ajuste
visual de umbrales**.

La auditoría con escenarios controlados reveló inconsistencias semánticas que, aisladas, no se manifestaban
(`informe-ia.md`, §4.2–4.5):

| Escenario controlado | Comportamiento v1 (observado) | Semántica esperada |
|---|---|---|
| Trayectoria saludable | Low (0.185) | Low |
| Manipulabilidad marginal (0.29) | **High** (0.639) | Medium |
| Manipulabilidad claramente baja (0.1) | **Critical** (0.894) | High |
| Solo singularidad cercana (prox 0.9) | **Low (0.000)** | ≥ Elevated |
| Baja manipulabilidad + singularidad | Critical | High/Critical |
| Clearance crítico | Critical | Critical |

Los hallazgos y sus correcciones fueron (`informe-ia.md`, §4.3–4.4):

- **A. La señal de singularidad era inerte**: la regla de proximidad a singularidad derivaba el hecho correspondiente y marcaba evidencia, pero **no contribuía al riesgo**. Un plan lleno de waypoints cerca de una singularidad producía riesgo 0.0 y veredicto Low. Corrección: la regla pasó a fijar riesgo High.
- **B. La manipulabilidad baja sobre-escalaba**: la regla de manipulabilidad baja derivaba el hecho de la regla de colisión, y la regla de combinación colapsaba, en la práctica, a "manipulabilidad baja → Critical". Corrección: la manipulabilidad baja deriva su propio hecho y fija riesgo High; la combinación hacia Critical exige ahora dos hechos independientes.
- **C. Funciones de pertenencia mal orientadas**: el conjunto "bajo" de manipulabilidad era un "bump" con pico en el umbral, de modo que un valor marginal (0.29) pesaba más como "bajo" que un valor claramente bajo (0.1); además, los conjuntos de salida medio y alto defuzzificaban exactamente en las fronteras de sus categorías. Correcciones: conjuntos de entrada monótonos (hombro decreciente / creciente) y salidas recentradas dentro de su bucket.
- **D. Una característica no robusta**: una variable de "complejidad de trayectoria" definida como el cociente entre cantidad de waypoints y duración resultó depender de la **densidad de interpolación**: en planes sintéticos cortos la escala era razonable, pero el pipeline real interpola densamente y saturaba el conjunto "alta", disparando su regla siempre. Se **eliminó** (variable y regla): medía densidad de interpolación, no complejidad semántica. Principio general: *una mala representación no se arregla necesariamente calibrando el modelo* — cuando una característica no representa el fenómeno, el ajuste de umbrales es cosmético; la corrección está en la representación.

Tras la recalibración, se añadieron pruebas de **vecinos** (puntos alrededor de las fronteras relevantes) para
garantizar veredictos estables y sin discontinuidades escondidas, y los escenarios controlados congelados quedaron como
sigue (`informe-ia.md`, §5.1):

| Escenario | Riesgo crisp | Veredicto |
|---|---|---|
| Trayectoria saludable | 0.147 | Low |
| Manipulabilidad marginal (0.29) | 0.391 | Medium |
| Manipulabilidad claramente baja (0.1) | 0.625 | High |
| Solo singularidad cercana (prox 0.9) | 0.625 | High |
| Baja manipulabilidad + singularidad | 0.771 | Critical |
| Clearance crítico (−0.1) | 0.917 | Critical |
| Triple degradación | 0.771 | Critical |

### 6.3 Evaluación de alternativas

La comparación entre la realización de referencia (baseline) y las alternativas se realiza bajo el mismo proceso de
evidencia, representación e inferencia que la directa: cada candidato atraviesa el pipeline completo. La evaluación se
rige por tres criterios de aceptación:

1. **Contrato de invariantes**: cada escenario se acepta si y solo si se cumplen sus invariantes (categorías y comparaciones relativas, según §6.1).
2. **Comparación objetivo**: la selección debe ser consecuencia matemática de la diferencia de métricas entre candidatos (`argmin J` con `J_selected ≤ J_direct`), nunca un criterio subjetivo.
3. **Garantía de completitud**: un escenario cuya entrada no puede compilar falla con el error real de la etapa. En la prueba, una entrada con targets fuera de los límites articulares del robot (valor 99 frente a un límite de ±2.443) propaga el rechazo real del planificador; un proceso roto nunca puede degradarse silenciosamente a un resultado categórico (`demo-scenarios.md`).

---

## 7. Resultados

### 7.1 Evaluación de una trayectoria desfavorable

El caso central es un programa que cruza la región desfavorable de la extensión completa del robot: la línea recta en el
espacio articular pasa por una singularidad localizada. La evaluación de la realización directa produce un veredicto
**High**, con evidencia de 2 waypoints singulares de 26, una duración de 7.818 s, un riesgo de **0.5571** y una calidad
de **0.4429** (con `quality = 1 − risk`). La trayectoria real genera 13 observaciones localizadas de singularidad (12 de
proximidad y 1 de singularidad efectiva).

| Realización | Riesgo | Calidad | Waypoints singulares | Duración (s) |
|---|---|---|---|---|
| Directa | **0.5571** | 0.4429 | 2 (de 26) | 7.818 |

La decisión no se presenta como "la IA encontró una trayectoria mejor". La formulación correcta es: **el método encontró
una realización alternativa porque la evidencia geométrica mostraba que la primera era menos favorable**.

### 7.2 Comparación con una alternativa

Ante la condición desfavorable, el método sintetiza una realización alternativa de la misma tarea —una variante con
configuración del codo— y la evalúa bajo los mismos criterios. La comparación es la siguiente (`demo-scenarios.md`):

| Realización | Riesgo | Calidad | Waypoints singulares | Duración (s) | Manip. | Costo | Estado |
|---|---|---|---|---|---|---|---|
| Directa | **0.5571** | 0.4429 | 2 (de 26) | 7.818 | 0.4585 | 1.0000 | admisible |
| AlternateElbow | **0.1625** | 0.8375 | 0 | 5.256 | 0.6314 | 0.0000 | admisible |

```text
SELECTED: AlternateElbow — riesgo 0.1625 frente a 0.5571 | endpoints/tarea preservados | razón derivada
```

El camino de la decisión, en términos del modelo (§5):

- **Evidencia**: la realización directa cruza la extensión completa → 2 waypoints singulares (de 26) y proximidades a singularidad; la realización seleccionada tiene 0.
- **Inferencia**: la regla de singularidad localizada eleva el riesgo a **High (0.557)**.
- **Evaluación**: calidad normalizada 0.443, `quality = 1 − risk`, traza auditable.
- **Generación**: generación acotada de candidatos (perturbación determinista sobre los waypoints problemáticos) → la realización alternativa; el mismo programa, misma tarea, mismos endpoints — distinta configuración del codo.
- **Selección**: criterio de admisibilidad + `argmin J` sobre el conjunto admisible → `J_selected ≤ J_direct`.

### 7.3 Casos donde no se genera alternativa

**Caso sano (selectividad).** Movimientos articulares pequeños en una región bien condicionada: la realización directa
ya es la mejor. El método **no inventa una alternativa** (`demo-scenarios.md`):

| Invariante | Valor verificado |
|---|---|
| Riesgo de la directa | 0.1470 (< 0.25, Low) |
| Mejor alternativa | ninguna admisible con `risk < seed_risk` |
| Seleccionada | = Directa |

```text
SELECTED: Directa — riesgo 0.1470 frente a 0.1470 | endpoints/tarea preservados | razón derivada
```

El diagnóstico (referencia, no aserción): la alternativa es admisible pero no estrictamente mejor (mismo riesgo 0.1470),
por lo que no existe alternativa mejor y la selección coincide con la realización directa.

**Caso sin alternativa razonable (honestidad).** Un programa de un solo segmento, sobre el cual ninguna estrategia
alternativa puede operar. El generador declara **"Skipped"**, no inventa (`demo-scenarios.md`):

| Realización | Riesgo | Calidad | Waypoints singulares | Duración (s) | Estado |
|---|---|---|---|---|---|
| Directa | 0.5567 | 0.4433 | 1 | 3.909 | admisible |

```text
SELECTED: Directa — riesgo 0.5567 frente a 0.5567 | endpoints/tarea preservados | razón derivada
```

El diagnóstico de la omisión es explícito: la estrategia de inserción de waypoints no es aplicable al programa (el
materializador solo divide objetivos cartesianos) y la variante de codo no puede resolver la configuración (no existe
configuración previa al segmento objetivo). El método declara la omisión y conserva la realización directa.

### 7.4 Trazabilidad de la decisión

La regla **R09**, que asocia la singularidad localizada al riesgo, eleva el veredicto a **High** a partir de la
evidencia local real. La historia completa del fenómeno, desde las observaciones crudas hasta el veredicto, valida la
representación de evidencia del método:

```text
13 observaciones (12 de proximidad + 1 singular) → agregadas → 0.033 (diluido) → v1: Low (0.248)
13 observaciones (12 de proximidad + 1 singular) → observaciones localizadas → 0.500 → R09 → High (0.557) → calidad 0.443
```

La primera versión, que recibía solo agregados, veredictaba **Low**: un fenómeno geométrico real quedaba reducido a una
fracción casi nula (0.033) por la agregación, y la manipulabilidad media (0.458) ocultaba el cruce localizado. El
rediseño incorporó la señal local desde las observaciones tipadas —invariante a la densidad de interpolación— y la misma
trayectoria pasó a veredictar **High (0.557)**.

El caso se validó **sin fabricarlo**: la trayectoria realmente produjo las 13 observaciones, y el veredicto cambió
porque la representación dejó de diluir la señal local (`informe-ia.md`, §4.6–4.8). La calidad se calcula como `quality
= 1 − risk`, proyección gradual de la misma evaluación.

---

## 8. Discusión

### 8.1 Qué demuestran los resultados

El riesgo crisp 0.557 es el **nivel crisp de riesgo producido por la inferencia difusa** —un grado derivado de la
composición de evidencia, **no una probabilidad estadística de fallo**. Esta distinción es central y debe mantenerse en
toda comunicación: decir "55,7 % de probabilidad de fallo" es incorrecto; el valor es una medida gradual del grado de
alarma que la evidencia compone.

Los resultados demuestran que **el método distingue realizaciones por evidencia**: la misma tarea, materializada con
distinta configuración del codo, produce riesgos 0.5571 frente a 0.1625, y la selección es la consecuencia matemática de
esa diferencia. La historia del descubrimiento de integración —13 observaciones agregadas a Low (0.033) y, tras el
rediseño de representación, elevadas a High (0.557) mediante observaciones localizadas— ilustra el valor de la
metodología experimental: **una mala representación no se arregla calibrando el modelo**. El caso se validó sin
fabricarlo.

### 8.2 Por qué funciona el enfoque

**Qué aporta la lógica difusa.** Gradualidad: una variable continua como la manipulabilidad no se evalúa con un umbral
binario, sino con grados de pertenencia que permiten distinguir una degradación marginal (0.29) de una degradación
severa (0.1) —precisamente el error de la versión inicial, donde la función de pertenencia invertida hacía pesar más lo
marginal. El riesgo crisp resultante es un grado derivado, no una clasificación binaria.

**Qué aporta el sistema experto.** Conocimiento explícito y prioridades: las reglas codifican el conocimiento
operacional de forma inspeccionable, la prioridad estructura la combinación de señales y el encadenamiento permite que
hechos derivados por unas reglas habiliten otras. Dos reglas previas establecen hechos independientes que una tercera
combina hacia Critical: el veredicto crítico no es consecuencia directa de una sola métrica, sino que requiere evidencia
compatible. La trazabilidad por disparo registra el razonamiento completo.

**Por qué la decisión es explicable.** La selección es `argmin J` sobre el conjunto admisible, con la razón derivada de
la comparación de métricas contra la realización de referencia; nunca es texto escrito a mano ni salida de un modelo
generativo. El método no muestra solo un veredicto: muestra el razonamiento y la comparación de alternativas.

### 8.3 Limitaciones

- **El veredicto Critical no ocurre en datos reales de SCARA**: la manipulabilidad baja y la singularidad cercana rara vez coexisten en la geometría del robot (la región de baja manipulabilidad tiene condición < 100; la señal de proximidad a singularidad exige condición > 100). El método no produce Critical artificialmente en datos reales: la singularidad localizada eleva a High, y Critical requiere evidencia combinada. Se demuestra en escenarios controlados, no en datos del robot (`informe-ia.md`, §5.1).
- **El parámetro `approach_height` negativo no está validado en la frontera**: el rango de valores extremos del parámetro es un follow-up conocido sin validación en la frontera del backend.
- **La comunicación del razonamiento en la interfaz está pendiente de auditoría**: el método está congelado; resta verificar que la interfaz comunica las afirmaciones de este informe —razonamiento, traza, distinción entre la métrica de salud estricta del analizador y la calidad gradual del evaluador (`informe-ia.md`, §9). La pantalla es de solo visualización y el flujo de datos es autoritativo, pero la verificación de que la interfaz efectivamente comunica el razonamiento es una auditoría pendiente.

---

## 9. Conclusiones

1. Los métodos de IA clásica —sistema experto con encadenamiento hacia adelante y lógica difusa con inferencia Mamdani— pueden usar evidencia geométrica real del pipeline robótico para analizar alternativas y tomar decisiones trazables sobre su calidad, en lugar de limitarse a producir una solución válida.
2. La calibración de una base de conocimiento es un proceso experimental, no un evento único: requiere escenarios de aceptación, auditoría, validación de frontera y recalibración con evidencia observada, no por ajuste visual.
3. La integración con el pipeline real es indispensable: reveló una pérdida de evidencia local que las pruebas aisladas no detectaban, y su corrección exigió rediseñar la representación de entrada, no recalibrar el modelo.
4. La representación de entrada importa tanto como las reglas: una característica no robusta (densidad de interpolación) se eliminó; la evidencia local se incorporó desde las observaciones tipadas, invariante a la discretización.
5. El sistema resultante produce decisiones inteligentes diferentes debido a evidencia geométrica real: evalúa, sintetiza y selecciona —con una razón derivada y trazable— del veredicto a la decisión.

El resultado no es un modelo que produce una etiqueta, sino un sistema que **convierte evidencia geométrica en
decisiones con consecuencias observables y razón derivada**.

---

## 10. Trabajo futuro

1. **Manipulabilidad localizada**: incorporar las observaciones de manipulabilidad baja como señal local (misma técnica que la singularidad), cuando un fallo demostrado lo justifique.
2. **Auditoría de la interfaz**: verificar que la interfaz comunica el razonamiento y la traza del método (distinción entre la métrica de salud estricta y la calidad gradual, factores del veredicto, comparación de alternativas) conforme a las afirmaciones de este informe.
3. **Analítica de ejecución**: conectar los datos de ejecución real con el ciclo de decisión para enriquecer la evaluación con información post-ejecución (comparación de trazas reales contra trayectorias planificadas).

---

## 11. Referencias

### 11.1 Referencias del repositorio

- `docs/deliverables/reports/informe-ia.md` — Evaluación inteligente de trayectorias robóticas: evidencia del sistema experto difuso, ciclo experimental (§4.2–4.8) y limitaciones (§9).
- `docs/execution/demos/demo-scenarios.md` — Biblioteca de escenarios demostrables: contratos de invariantes, evidencia de referencia y garantía de completitud.
- `docs/deliverables/presentations/ia-como-decide.md` — Presentación "¿Cómo decide Thalos?": tesis central, evidencia, caso central e interfaz.
- `docs/deliverables/presentations/narrativa-defensa.md` — Narrativa de defensa: ciclo de detección/evaluación/generación/selección y momento central de selección.

### 11.2 Referencias académicas

- Russell, S. y Norvig, P. (2020). *Artificial Intelligence: A Modern Approach* (4.ª ed.). Pearson. [Búsqueda de objetivos, toma de decisiones racionales y planificación].
- Jackson, P. (1999). *Introduction to Expert Systems* (3.ª ed.). Addison-Wesley. [Sistemas expertos, encadenamiento hacia adelante, bases de reglas].
- Zadeh, L. A. (1965). "Fuzzy sets". *Information and Control*, 8(3), 338–353. [Fundamentos de la lógica difusa].
- Mamdani, E. H. y Assilian, S. (1975). "An experiment in linguistic synthesis with a fuzzy logic controller". *International Journal of Man-Machine Studies*, 7(1), 1–13. [Inferencia difusa Mamdani: fuzzificación, reglas, agregación, defuzzificación].

---

## Anexo A — Correspondencia con la implementación

Este anexo vincula los conceptos del cuerpo del informe con los nombres concretos de la implementación sobre la
plataforma Thalos. Los nombres que aparecen aquí son exclusivamente detalles de ingeniería; el cuerpo del informe los
describe deliberadamente por su rol conceptual. Los identificadores de reglas y métricas de este anexo son los nombres
internos del sistema.

| Etapa / concepto del informe | Implementación (Thalos) |
|---|---|
| Informe de análisis con métricas agregadas y observaciones localizadas | `AnalysisReport` emitido por el pipeline de análisis de la plataforma |
| Plataforma experimental (pipeline de evidencia) | Thalos — compilación de programas, interpolación, análisis geométrico (Jacobiano, índice de Yoshikawa, número de condición, colisiones SAT/OBB, límites articulares) |
| Evaluación de riesgo (sistema experto difuso, 11 reglas, 3 variables lingüísticas) | Crate `thalos-intelligence`; base de reglas y capa Mamdani |
| Regla de singularidad localizada → riesgo High | `R09_near_singularity` → `RiskIs High` |
| Reglas de combinación hacia Critical | `R07_low_manipulability`, `R11` (combinación de hechos independientes) |
| Evaluador de riesgo (etapa de evaluación) | `Assessor` (evaluador global) |
| Reparación local de fallos (rol complementario) | `PlanAdvisor` (recomendaciones; productor único de remediaciones) |
| Criterio de admisibilidad y función de costo `J` | Evaluador de costos componible y ponderable — `docs/adr/ADR-0004-evaluation-engine.md` |
| Generación de alternativas (biblioteca acotada de estrategias) | Generador determinista de candidatos (`CandidateGenerator`) |
| Evaluación de candidatos y selección (`argmin J`) | Evaluador de candidatos (`CandidateEvaluator`) y capa de asistencia al planificador — `docs/adr/ADR-0005-planning-assistant.md` (capabilities Analyze / Advise / Explain / Optimize) |
| Caso desfavorable (cruce de la extensión completa) | Fixture `crossing-pick-place-home` (razonamiento contrafáctico) |
| Caso sano (sin invención de alternativas) | Fixture `healthy-pick-place-home` (selectividad) |
| Caso sin alternativa razonable ("Skipped") | Fixture `single-segment-crossing` (acotación/honestidad) |
| Garantía de completitud | Guard `pipeline-completion`; seed `[MoveJ op-broken [99, 99, 99, 99]]` |
| Métricas agregadas de la trayectoria | `avg_manipulability`, `min_collision_distance`, `near_singular_count`, `singular_count`, `waypoint_count`, `trajectory_duration` |
| Señal local de singularidad (invariante a la discretización) | `localized_singularity` (0 = ausente, 0.15 = solo proximidad, 0.5 = evento singular) |
| Característica no robusta eliminada | `trajectory_complexity` (densidad de interpolación, no complejidad semántica) |
| Métrica estricta del analizador vs. calidad gradual del evaluador | `health` (score por conteo de fallos) vs. `quality = 1 − risk` |
| Parámetro de interfaz con consecuencia observable | `approach_height` |
| Realizaciones de referencia / alternativa del caso central | `Direct` vs `AlternateElbow` |
| Suites de verificación | `thalos-intelligence` (unit + aceptación + goldens: 59 + 3 + 8), `thalos-planning` (demo + contrato + usabilidad: 2 + 4 + 10), `thalos_runtime` (290), `thalos_api` (api_tests: 95) |
