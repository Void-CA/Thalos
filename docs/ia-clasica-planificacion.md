# Análisis del Sistema de Planificación de Thalos desde la Perspectiva de la Inteligencia Artificial Simbólica

> **Propósito**: Este documento analiza el sistema de planificación de
> Thalos —un robot manipulador planar 2GDL— identificando qué componentes
> corresponden realmente a técnicas de inteligencia artificial simbólica
> y cuáles pertenecen a la infraestructura robótica que las soporta.
>
> Se enmarca como estudio para una asignatura de *IA Clásica / IA
> Simbólica*, usando Thalos (proyecto de Robótica) como dominio de
> aplicación. La distinción entre IA e infraestructura es deliberada:
> no todo algoritmo es IA, y parte del valor del análisis está en
> reconocer la diferencia.
>
> **Referencias teóricas**: El análisis se sitúa dentro del marco de la
> IA clásica según Russell & Norvig (2021), Nilsson (1998), y la
> tradición GOFAI (*Good Old-Fashioned Artificial Intelligence*).

---

## 1. Introducción: El Ciclo Clásico de la IA Simbólica

La inteligencia artificial simbólica —también llamada IA clásica o
GOFAI— se caracteriza por la manipulación explícita de símbolos, la
representación declarativa del conocimiento, la búsqueda en espacios de
estados, y el razonamiento basado en reglas. Su estructura clásica sigue
el ciclo:

```
    Percepción
        ↓
    Representación del conocimiento
        ↓
    Razonamiento
        ↓
    Planificación
        ↓
    Acción
```

Este ciclo, descrito en los textos fundacionales de la IA (Newell &
Simon 1976, Nilsson 1998), aparece completo en el sistema de
planificación de Thalos:

```
    Trayectoria (datos crudos del plan)
        │
        ▼
    ┌──────────────────────────────┐
    │ TrajectoryAnalyzer           │ ← PERCEPCIÓN
    │ "Inspecciona cada waypoint   │
    │  y produce hechos objetivos" │
    └──────────────┬───────────────┘
                   │ Findings
                   ▼
    ┌──────────────────────────────┐
    │ PlanningKnowledge            │ ← REPRESENTACIÓN DEL CONOCIMIENTO
    │ "Conocimiento explícito del  │
    │  robot y su workspace"       │
    └──────────────┬───────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │ PlanAdvisor (reglas)         │ ← RAZONAMIENTO
    │ RepairPlanner (heurísticas)  │
    │ "Infieren diagnosis y        │
    │  seleccionan reparaciones"   │
    └──────────────┬───────────────┘
                   │ Recomendaciones / Reparaciones
                   ▼
    ┌──────────────────────────────┐
    │ MoveJPlanner / MoveLPlanner  │ ← PLANIFICACIÓN
    │ PlanCompiler                 │
    │ "Generan trayectorias que    │
    │  satisfacen las metas"       │
    └──────────────┬───────────────┘
                   │ Plan compilado
                   ▼
    ┌──────────────────────────────┐
    │ Execution Runtime            │ ← ACCIÓN
    │ "Ejecuta el plan en el       │
    │  robot (real o simulado)"    │
    └──────────────────────────────┘
```

A lo largo de este documento analizaremos cada etapa, distinguiendo
entre los componentes que realmente constituyen IA simbólica y la
infraestructura robótica que los hace posibles.

---

# Parte I: Fundamentos de Inteligencia Artificial Presentes

---

## 2. Representación del Conocimiento

> **Russell & Norvig (Cap. 10):** "La representación del conocimiento
> es el área de la IA que estudia cómo expresar información sobre el
> mundo en una forma que un sistema computacional pueda utilizar para
> resolver tareas complejas."

Este es probablemente el componente más distintivo de IA simbólica en
Thalos. El conocimiento no está embebido en pesos sinápticos —como
ocurriría en un enfoque conexionista— sino que se almacena en
estructuras de datos declarativas, inspeccionables y modificables.

### 2.1. PlanningKnowledge: Conocimiento Explícito del Robot y su Entorno

**Archivo**: `thalos-planning/src/knowledge/domain.rs`

El sistema define dos niveles de conocimiento:

```rust
pub struct PlanningKnowledge {
    pub robot: RobotKnowledge,
    pub workspace: Option<WorkspaceKnowledge>,
}

pub struct RobotKnowledge {
    pub dof: usize,
    pub joint_limits: Vec<JointLimit>,
    pub tcp_frame: FrameId,
}

pub struct WorkspaceKnowledge {
    pub reachability: Option<ReachabilityMap>,
    pub manipulability: Option<ManipulabilityField>,
    pub singularity_zones: Vec<SingularityZone>,
    pub preferred_configs: Vec<ConfigurationRegion>,
}
```

**¿Por qué esto es IA simbólica?**

1. **Explícito**: cada zona de singularidad, límite articular y campo de
   manipulabilidad está representado como datos que pueden leerse e
   inspeccionarse. No hay "caja negra".

2. **Declarativo**: el conocimiento dice *qué* es verdad (qué zonas son
   singulares, qué configuraciones son preferidas), no *cómo* usarlo.
   Eso se separa en los motores de inferencia (PlanAdvisor,
   RepairPlanner).

3. **Modificable**: cambiar el conocimiento no requiere reentrenar un
   modelo. Se puede ajustar una zona de singularidad, añadir una
   configuración preferida, o refinar la resolución del mapa de
   alcanzabilidad.

4. **Reutilizable**: el mismo `WorkspaceKnowledge` puede ser consultado
   por el `RepairPlanner` para guiar la selección de estrategias y por
   el `GoalResolver` para validar metas.

5. **Consultable mediante inferencia**: la `SingularityZone` incluye un
   método `contains(q)` que permite responder preguntas como "¿Está la
   configuración q dentro de una zona de singularidad conocida?". Esto
   es equivalente a un **silogismo geométrico**:

```rust
impl SingularityZone {
    pub fn contains(&self, q: &[f64]) -> bool {
        let dist: f64 = q.iter()
            .zip(&self.center)
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        dist <= self.radius
    }
}
```

### 2.2. El Grafo Cinemático como Estructura de Conocimiento

**Archivo**: `thalos-models/src/graph.rs`

El robot se representa como un **grafo dirigido acíclico (DAG)** —el
árbol cinemático— donde los nodos son *links* (eslabones) y las aristas
son *joints* (articulaciones):

```
     base (root)
      /    \
   j1       j3
   /         \
 link1       link3
   |          |
   j2         j4
   |          |
 link2      link4 (TCP)
```

El grafo se construye mediante un **recorrido BFS** desde la raíz y los
hijos se ordenan alfabéticamente dentro de cada nivel para garantizar
**determinismo** en el recorrido. Esta decisión de diseño —el orden de
exploración es explícito y controlado— es una preocupación típica de IA
clásica donde el determinismo del motor de inferencia es crítico: el
mismo robot produce siempre el mismo grafo, en el mismo orden, sin
importar la máquina o la semilla del hash.

### 2.3. Hechos Objetivos (Findings) como Base de Hechos

**Archivo**: `thalos-planning/src/finding.rs`

El sistema introduce una distinción epistemológica fundamental análoga a
la que existe en los sistemas expertos entre **base de hechos** (working
memory) y **base de reglas** (production rules). Un `Finding` es un
hecho objetivo: no prescribe qué hacer, solo declara una observación.

```rust
pub struct Finding {
    pub kind: FindingKind,   // LowManipulability, Singularity, Collision...
    pub severity: Severity,  // Info, Warning, Error
    pub waypoint: Option<usize>,
    pub message: String,
    pub value: Option<f64>,      // Valor observado
    pub threshold: Option<f64>,  // Umbral que se superó para generarlo
}
```

Los Findings constituyen la **base de hechos** (working memory) que
alimenta al motor de reglas (`PlanAdvisor`). Esta separación es
intencional y está documentada en el código:

> *El Advisor NUNCA recalcula. Solo interpreta hallazgos. No vuelve a
> preguntar al Jacobiano, no vuelve a consultar colisiones. No llama a
> FK. No llama a SVD. Si necesita más datos, el Analyzer debe
> producirlos como Findings.*

---

## 3. Búsqueda en Múltiples Espacios de Estados

> **Russell & Norvig (Cap. 3):** "La búsqueda es el proceso de
> considerar secuencias de acciones que conducen a estados objetivo."

Thalos implementa algoritmos de búsqueda en **distintos espacios**, cada
uno con su propia definición de estado, operador y meta:

| Espacio de búsqueda | Estado | Operador | Meta | Algoritmo |
|---|---|---|---|---|
| **Cinemático** | Link actual en el árbol | Transitar a un hijo a través de una articulación | Alcanzar el link objetivo | DFS con backtracking |
| **Articular (joint-space)** | Configuración q ∈ ℝⁿ | Interpolar hacia q_objetivo | Alcanzar configuración articular | Interpolación trapezoidal directa |
| **Cartesiano (task-space)** | Pose del TCP | Muestrear camino + resolver IK | Alcanzar pose objetivo | Muestreo lineal + IK por punto |
| **Programa (multi-segmento)** | Segmento actual del programa | Compilar segmento y pasar al siguiente | Compilar todos los segmentos sin error | PlanCompiler secuencial |
| **Reparación** | Región problemática actual | Aplicar estrategia de reparación | Resolver todas las regiones | RepairPlanner con ranking heurístico |
| **Reglas (pattern matching)** | Finding actual | Coincidir con regla de producción | Generar recomendación | Forward chaining (PlanAdvisor) |

### 3.1. Búsqueda en Profundidad (DFS) en el Espacio Cinemático

**Archivo**: `thalos-models/src/graph.rs` — `dfs_path()`

Para encontrar la ruta cinemática entre dos eslabones (por ejemplo, de
`base` a `tool`), el sistema utiliza **búsqueda en profundidad** con
retroceso (*backtracking*):

```rust
fn dfs_path(&self, current: LinkId, target: LinkId,
            links: &mut Vec<LinkId>, joints: &mut Vec<JointId>,
            visited: &mut HashSet<LinkId>) -> bool {
    links.push(current);
    if current == target { return true; }
    if !visited.insert(current) { links.pop(); return false; }

    for &child in &self.children[current as usize] {
        if let Some(j_id) = self.parent_joint(child) {
            joints.push(j_id);
            if self.dfs_path(child, target, links, joints, visited) {
                return true;
            }
            joints.pop(); // backtrack
        }
    }
    visited.remove(&current);
    links.pop();
    false
}
```

**Características de IA clásica**:
- **Espacio de búsqueda**: árbol cinemático completo (V vértices, E aristas).
- **Operador**: transición de un eslabón a su hijo a través de una articulación.
- **Prueba de meta**: `current == target`.
- **Retroceso (backtracking)**: cuando falla una rama, deshace las
  inserciones y prueba otra —mecanismo clásico desde Depth-First Search
  de Nilsson (1971).
- **Ciclo detection**: conjunto `visited` para evitar ciclos.
- **Complejidad**: O(V + E) sobre el árbol cinemático.

### 3.2. Búsqueda en Anchura (BFS) para Construcción del Grafo

**Archivo**: `thalos-models/src/graph.rs` — `from_robot()`

La construcción del grafo usa BFS para asignar IDs secuenciales:

```rust
let mut queue: VecDeque<String> = VecDeque::new();
queue.push_back(robot.root_link.clone());

while let Some(current_name) = queue.pop_front() {
    // Explorar hijos, asignar IDs, encolar
}
```

El BFS garantiza IDs **deterministas** —misma entrada produce siempre el
mismo grafo—, propiedad esencial para la reproducibilidad en cualquier
sistema de IA simbólica.

### 3.3. PlanCompiler como Búsqueda en el Espacio del Programa

**Archivo**: `thalos-planning/src/motion/compiler.rs`

El `PlanCompiler` es un **planificador jerárquico** que recorre
secuencialmente los segmentos de un programa de usuario. No es
simplemente un "ejecutor": es un proceso que:

1. **Selecciona** el planificador adecuado para cada segmento (MoveJ vs.
   MoveL) según la intención del usuario.
2. **Valida** la meta mediante el `GoalResolver`, que aplica reglas
   (límites articulares, umbrales de singularidad) para aceptar o
   rechazar el objetivo.
3. **Compila** cada segmento generando la trayectoria correspondiente.
4. **Acumula** los resultados en un plan unificado con tiempos absolutos.
5. Si falla un segmento, **aborta** con diagnóstico del error (qué
   segmento y por qué).

En términos de IA clásica, el `PlanCompiler` es un planificador que
opera sobre un espacio de programas, donde el estado es "cuántos
segmentos se han compilado" y el operador es "compilar el siguiente
segmento utilizando el planificador adecuado".

### 3.4. Pattern Matching como Búsqueda en el Espacio de Reglas

**Archivo**: `thalos-planning/src/advisor/mod.rs`

El `PlanAdvisor` implementa **pattern matching** sobre los Findings:
cada regla inspecciona el `kind` del Finding y, si coincide, genera una
o más Recommendations. Es el mismo principio que utilizan los motores de
reglas clásicos como CLIPS, Jess u OPS5:

```
Finding{Collision} ──→ Regla R4 ──→ Recommendation{Collision, High}
Finding{NearSingularity} ──→ Regla R2 ──→ Recommendation{Singularity, High}
                                            Recommendation{Velocity, Medium}
```

Aunque Thalos no implementa el algoritmo Rete (el número de reglas es
demasiado pequeño para justificarlo), la **arquitectura conceptual** es
idéntica: una base de hechos (Findings) es cotejada contra un conjunto
de reglas de producción para generar nuevas conclusiones
(Recommendations).

---

## 4. Planificación

> **Russell & Norvig (Cap. 11):** "La planificación es el problema de
> seleccionar una secuencia de acciones que alcance un objetivo,
> utilizando un modelo explícito del entorno."

El problema central que resuelve Thalos es: *dado un estado inicial del
robot y un objetivo (configuración articular o pose cartesiana),
seleccionar una trayectoria que lleve al robot al objetivo respetando
restricciones cinemáticas y de seguridad*.

Es importante distinguir: la **interpolación** (cómo se genera cada
punto de la trayectoria) es un mecanismo de ejecución —infraestructura
robótica—, no IA. La **planificación** es la decisión de qué tipo de
movimiento usar, qué meta validar, y cómo combinar segmentos —eso sí es
IA.

### 4.1. MoveJPlanner y MoveLPlanner como Generadores de Planes

**Archivo**: `thalos-planning/src/motion/move_j.rs`, `motion/move_l.rs`

Estos planificadores implementan el trait `MotionPlanner`:

```rust
pub trait MotionPlanner {
    type Goal;
    fn plan(&self, ctx: &PlanningContext, goal: &ValidatedGoal<Self::Goal>)
        -> PlanningResult;
}
```

La IA no está en la interpolación (trapezoidal o lineal), sino en:

1. **Seleccionar** el espacio de planificación adecuado (joint vs.
   task) según el tipo de movimiento deseado por el usuario.
2. **Validar** la meta mediante el `GoalResolver`, que decide si el
   objetivo es alcanzable bajo las restricciones actuales.
3. **Generar** una secuencia de configuraciones articulares (el plan)
   que constituye la solución al problema planteado.
4. **Reportar** fallos con diagnóstico cuando el plan no es factible.

### 4.2. PlanCompiler como Planificador Jerárquico

**Archivo**: `thalos-planning/src/motion/compiler.rs`

El `PlanCompiler` es el **planificador de más alto nivel**. Orquesta la
planificación de múltiples segmentos en un programa completo:

```
Programa de usuario:                Plan compilado:
  Segmento 1: MoveJ a [0.5, 0.5]     Trayectoria A (q0 → q1) con perfil J
  Segmento 2: MoveL a Pose{x=0.8}    Trayectoria B (q1 → q2) con perfil L
  Segmento 3: MoveJ a [0.0, 0.0]     Trayectoria C (q2 → q0) con perfil J
```

La compilación tiene **atomicidad**: o se genera el plan completo, o se
reporta el error con el segmento fallido y su causa. Esto corresponde a
la idea de **planes como secuencias de acciones** en planificación
clásica (STRIPS, PDDL), donde un plan es una secuencia de operadores que
transforman el estado del mundo desde un estado inicial hasta un estado
objetivo.

---

## 5. Sistema Experto Basado en Reglas

> **Russell & Norvig (Cap. 7):** "Un sistema basado en reglas codifica
> el conocimiento de un experto humano como un conjunto de reglas
> condicionales (SI → ENTONCES) que se aplican a una base de hechos."

Este es el componente más puramente representativo de la IA clásica en
Thalos. El sistema experto no es el `TrajectoryAnalyzer` (que solo
produce hechos), sino el **`PlanAdvisor`**, que contiene las reglas de
producción.

### 5.1. Arquitectura del Sistema Experto

```
                    BASE DE HECHOS (Findings)
                    ┌──────────────────────────┐
                    │ Finding{LowManipulability}│
                    │ Finding{NearSingularity}  │
                    │ Finding{Collision}        │
                    │ Finding{ConstraintViolation}│
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │    MOTOR DE INFERENCIA   │
                    │      (PlanAdvisor)       │
                    │                          │
                    │  Reglas de producción:   │
                    │  PATTERN MATCHING        │
                    │  SI finding.kind == X    │
                    │  ENTONCES generar Rec Y  │
                    └──────────┬───────────────┘
                               │
                    BASE DE RECOMENDACIONES
                    ┌──────────────────────────┐
                    │ Recommendation{Manip.}   │
                    │ Recommendation{Singular} │
                    │ Recommendation{Collision}│
                    └──────────────────────────┘
```

### 5.2. Reglas de Producción

**Archivo**: `thalos-planning/src/advisor/mod.rs`

El `PlanAdvisor` implementa **reglas de producción** puras. Cada regla
sigue la forma `SI <patrón> ENTONCES <acción>`:

```
R1: SI FindingKind == LowManipulability
    ENTONCES generar:
      - Recommendation{kind: Manipulability, impacto: High}
        "Baja manipulabilidad (x.xxx). Cambiar solver IK puede mejorar."
      - Recommendation{kind: Waypoint, impacto: Medium}
        "Agregar waypoint intermedio en la región de baja manipulabilidad."

R2: SI FindingKind == NearSingularity
    ENTONCES generar:
      - Recommendation{kind: Singularity, impacto: High}
        "Cerca de singularidad. Reducir velocidad o ajustar configuración."
      - Recommendation{kind: Velocity, impacto: Medium}
        "Reducir velocidad máxima evita problemas near-singular."

R3: SI FindingKind == Singularity
    ENTONCES Recommendation{kind: Singularity, impacto: High}

R4: SI FindingKind == Collision
    ENTONCES Recommendation{kind: Collision, impacto: High}

R5: SI FindingKind == CollisionNear
    ENTONCES Recommendation{kind: Collision, impacto: Medium}

R6: SI FindingKind == ConstraintViolation
    ENTONCES Recommendation{kind: Constraint, impacto: High}
```

**Características de IA clásica**:
- **Pattern Matching**: cada regla inspecciona el `kind` del Finding
  para determinar si aplica. Es el mismo mecanismo que CLIPS, Jess u
  OPS5, adaptado a un número pequeño de reglas (sin algoritmo Rete).
- **Encadenamiento hacia adelante** (forward chaining): los hechos
  (Findings) se producen primero, y luego se aplican las reglas para
  derivar nuevas conclusiones. No hay encadenamiento hacia atrás.
- **Determinismo**: mismas entradas producen siempre las mismas
  recomendaciones.
- **Interpretabilidad**: cada recomendación es trazable al finding que
  la originó.
- **Separación conocimiento-control**: las reglas (el conocimiento del
  experto) están separadas del motor de inferencia (el código que las
  aplica).

### 5.3. El Analyzer como Generador de Hechos (no como Sistema Experto)

**Archivo**: `thalos-planning/src/analysis/mod.rs`

El `TrajectoryAnalyzer` **no es** parte del sistema experto. Su función
es **generar la base de hechos** (Findings) que el sistema experto
consumirá. Por cada waypoint de la trayectoria realiza cálculos
geométricos (FK, Jacobiano, SVD, distancias) y produce hechos cuando se
superan umbrales:

```
Waypoint i → FK → Jacobiano → SVD → Condition Number → Finding?
                                     → Yoshikawa Index → Finding?
                        → Colisiones O(n²) → Finding?
                        → Constraints → Finding?
```

```
If condición:
  LowManipulability  si  yoshikawa < 0.3
  NearSingularity     si  100 < cond_number < 1000
  Singularity         si  cond_number ≥ 1000
  Collision           si  distancia < 0
  CollisionNear       si  0 < distancia < 0.05
```

La separación es clave: el Analyzer produce **hechos** (geometría
analítica deductiva), el Advisor produce **recomendaciones** (inferencia
basada en reglas). Solo el segundo constituye IA simbólica.

### 5.4. Detección de Regiones Problema (Segmentación)

**Archivo**: `thalos-planning/src/analysis/region.rs`

El `RegionDetector` agrupa findings individuales en **regiones
contiguas**. Es un algoritmo de **segmentación** que agrupa hallazgos
puntuales (waypoints individuales) en regiones con significado. Aunque
simple, este paso es necesario para que el sistema experto y el
reparador puedan razonar sobre *tramos* problemáticos en lugar de
puntos aislados.

```
Pipeline:
1. Normalizar findings
2. Detectar regiones contiguas (gap threshold)
3. Calcular health score por región (0.0 = crítica, 1.0 = óptima)
```

---

## 6. Razonamiento para Resolución de Problemas (RepairPlanner)

> **Russell & Norvig (Cap. 3, 11):** "La resolución de problemas es el
> proceso de encontrar una secuencia de acciones que transforme un
> estado inicial en un estado objetivo."

El `RepairPlanner` es posiblemente el componente más interesante desde
la perspectiva de la IA clásica, porque implementa el ciclo completo de
**resolución de problemas**:

```
     ProblemRegion (estado actual: hay un problema)
          │
          ▼
     Knowledge Base (¿qué sabemos del workspace?)
          │
          ▼
     Generar alternativas (LiftTcp, RotateTool, SplitSegment...)
          │
          ▼
     Evaluar cada candidato (métricas before/after)
          │
          ▼
     Rankear por mejora estimada
          │
          ▼
     Seleccionar la mejor reparación
          │
          ▼
     Aplicar PlanDelta (ejecutar la acción seleccionada)
```

### 6.1. El Proceso de Resolución de Problemas

**Archivo**: `thalos-planning/src/repair/planner.rs`

```
Para cada ProblemRegion:
  1. FILTRAR estrategias aplicables (solo las que el tipo de región acepta)
  2. GENERAR candidatos (cada estrategia produce uno o más planes delta)
  3. EVALUAR candidatos (métricas before/after — mejora estimada)
  4. RANKEAR por improvement score
  5. RECOMENDAR el mejor candidato (si mejora > 0)
```

Cada uno de estos pasos corresponde a una función clásica en resolución
de problemas:

1. **Filtrado**: seleccionar operadores aplicables (como en STRIPS,
   donde solo ciertos operadores aplican a ciertos estados).
2. **Generación**: expandir el espacio de búsqueda generando candidatos
   (como generar sucesores en A*).
3. **Evaluación**: asignar un valor numérico a cada candidato (como la
   función heurística h(n) en búsqueda informada).
4. **Ranking**: ordenar por valor para seleccionar el mejor (como la
   cola de prioridad en Best-First Search).
5. **Selección**: escoger el mejor candidato si supera un umbral de
   mejora.

### 6.2. Uso de Conocimiento para Guiar la Búsqueda

Cuando hay `PlanningKnowledge` disponible, el ranking se ajusta usando
conocimiento previo del workspace. Esto convierte al RepairPlanner en
un **planificador informado** (análogo a A* vs. búsqueda ciega):

```rust
fn knowledge_recommendations(&self, region, knowledge) -> Vec<StrategyRecommendation> {
    let mut lift_score = 0.5;
    if knowledge.nearby_singularity(q).is_some() { lift_score += 0.3; }
    if knowledge.manipulability_at(q) < 0.2 { lift_score += 0.2; }

    let mut rotate_score = 0.4;
    if near_singularity { rotate_score += 0.1; }

    let mut split_score = 0.3;
    if region.waypoint_range.len() > 50 { split_score += 0.2; }

    vec![LiftTcp(lift_score), RotateTool(rotate_score), SplitSegment(split_score)]
}
```

El conocimiento (`PlanningKnowledge`) se usa como una **heurística de
selección**: asigna un puntaje a cada estrategia basándose en
información previamente adquirida sobre el workspace, sin necesidad
de ejecutar la reparación para saber si sería efectiva.

### 6.3. Estrategias de Reparación como Operadores

**Archivo**: `thalos-planning/src/repair/strategies/`

Cada estrategia implementa el trait `RepairStrategy` y constituye un
**operador** en el espacio de búsqueda de reparaciones:

| Estrategia | Operador | Cuándo aplica |
|---|---|---|
| **LiftTcp** | Aplicar offset Z al TCP y resolver IK | Singularidades, baja manipulabilidad |
| **RotateTool** | Rotar la orientación del TCP alrededor del eje Z | Singularidades cercanas |
| **SplitSegment** | Insertar waypoints intermedios para mejor discretización | Regiones largas o cerca de obstáculos |

### 6.4. Fusión de Planes como Revisión de Planes

**Archivo**: `thalos-planning/src/repair/merger.rs`

El `PlanMerger` aplica un `PlanDelta` —reemplazo de un segmento de
trayectoria— al plan compilado, validando **continuidad C0**. Esto es un
**operador de revisión de planes** en el sentido de la planificación
clásica: modifica un plan existente preservando su estructura general.
Es conceptualmente análogo a los operadores de *plan repair* en sistemas
POP (Partial-Order Planning) o HTN (Hierarchical Task Network).

---

## 7. Evaluación Heurística (CostFunction)

> **Russell & Norvig (Cap. 3):** "Una función heurística h(n) estima el
> costo del camino más barato desde el estado n hasta el objetivo."

La `CostFunction` de Thalos implementa el mismo principio que las
funciones heurísticas de la IA clásica: asigna un **valor numérico a un
estado** (en este caso, a un plan completo) para permitir la
**comparación objetiva** entre alternativas.

**Archivo**: `thalos-planning/src/evaluation/cost.rs`

```rust
// total = Σ w_i × normalized_metric_i
pub fn score(&self, metrics: &PlanMetrics) -> PlanScore {
    let mut total = 0.0;

    // Path length: normalizado por cota superior (10 rad)
    let len_val = (metrics.length / 10.0).min(1.0);
    total += len_val * w(PathLength);

    // Manipulability: menor manip = mayor costo
    let manip_val = (1.0 - metrics.manipulability.average) * 0.5
                  + (1.0 - metrics.manipulability.min) * 0.5;
    total += manip_val * w(Manipulability);

    // ... similar para JointMargin, CollisionRisk, Smoothness, OrientationChange

    PlanScore { total, breakdown, summary }
}
```

**Razones por las que esto es IA clásica**:
- Es una **función de evaluación** que asigna un valor numérico a un
  estado (el plan) para guiar la toma de decisiones.
- Sigue la misma filosofía que las funciones heurísticas en A\*, AO\*,
  Best-First Search, Minimax, y otros algoritmos clásicos de búsqueda
  informada.
- Es una **función de utilidad multi-atributo (MAUT)**: cada dimensión
  de calidad se normaliza a [0, 1] y se pondera según su importancia
  relativa.
- Los pesos son **configurables**, lo que permite adaptar el
  comportamiento del sistema a distintas preferencias —equivalente a
  ajustar la función de evaluación en un sistema experto.

El resultado (`PlanScore`) incluye un **desglose por métrica**
(`breakdown`) que permite explicar por qué un plan obtuvo cierto puntaje
—una propiedad esencial en sistemas de IA simbólica, donde la
**explicabilidad** es un requisito fundamental.

---

# Parte II: Infraestructura Robótica de Soporte

---

## 8. Componentes de Robótica e Ingeniería que Soportan la IA

Los siguientes componentes son **necesarios** para que el sistema
funcione, pero **no constituyen IA por sí mismos**. Son algoritmos de
robótica, geometría computacional o ingeniería de software que actúan
como la capa base sobre la cual operan los componentes de IA.

### 8.1. Cinemática Directa (FK)

**Archivo**: `thalos-core/src/kinematics/forward/`

Calcula la pose del efector final a partir de una configuración
articular: `pose = fk.evaluate(q)`. Es un algoritmo puramente
geométrico basado en la composición de transformaciones homogéneas
(cadenas de matrices 4×4). No hay decisión, búsqueda ni inferencia:
es una función matemática determinista.

### 8.2. Cinemática Inversa (IK)

**Archivo**: `thalos-core/src/kinematics/inverse/`

Resuelve el problema inverso: encontrar q tal que FK(q) ≈ pose_target.
Utiliza métodos iterativos como Jacobiano Traspuesto. Aunque involucra
una búsqueda numérica (iteraciones), esta es una **optimización
numérica**, no una búsqueda simbólica en un espacio de estados. No hay
representación del conocimiento ni reglas de inferencia.

### 8.3. Jacobiano Geométrico y SVD

**Archivo**: `thalos-core/src/kinematics/jacobian/`

Calcula la matriz Jacobiana J(q) y su descomposición en valores
singulares (SVD). Produce métricas como el **condition number**
(proximidad a singularidad) y el **índice de Yoshikawa**
(manipulabilidad). Son cálculos de álgebra lineal. La IA aparece cuando
*esos valores se interpretan* para generar un Finding o guiar una
decisión —no en el cálculo mismo.

### 8.4. Interpoladores de Trayectoria

**Archivo**: `thalos-planning/src/interpolate/`

Generan puntos intermedios entre dos configuraciones:
- `trapezoidal_profile()`: genera perfil de velocidad trapezoidal.
- `lerp()` / `slerp()`: interpolación lineal y esférica.
- `linear_path()`: muestreo de caminos cartesianos.

Son algoritmos de generación de trayectorias. El *mecanismo* de
interpolación no es IA; la *decisión* de qué tipo de interpolación
usar y con qué parámetros —eso podría serlo, y en Thalos lo decide
el usuario al elegir MoveJ vs. MoveL.

### 8.5. Detección de Colisiones

**Archivo**: `thalos-collision/src/`, `thalos-planning/src/collision.rs`

Usa SAT (Separating Axis Theorem) para detectar intersecciones entre
cuerpos geométricos y calcular distancias mínimas. Es geometría
computacional pura, O(n²) en el número de cuerpos. La IA aparece cuando
el resultado de este cálculo se convierte en un `Finding{Collision}` que
alimenta al sistema experto.

### 8.6. Máquina de Estados de Ejecución

**Archivo**: `thalos-runtime/src/plan/plan.rs`

El `ActiveMotionPlan` se modela como una máquina de estados finita
(Created → Active → Paused → Completed/Cancelled/Failed). Es un
**patrón de diseño de software**, no IA. Controla el ciclo de vida de la
ejecución, pero no realiza inferencia ni razonamiento.

### 8.7. Runtime de Ejecución

**Archivo**: `thalos-runtime/src/`

Orquesta la ejecución de planes, maneja sesiones, y se comunica con
backends físicos o simulados. Es infraestructura de software. La IA
termina donde empieza la ejecución: el plan se genera con técnicas de
IA, pero su ejecución es un proceso de control.

---

## 9. Construcción de la Base de Conocimiento (Monte Carlo)

**Archivo**: `thalos-planning/src/knowledge/builder.rs`

El conocimiento del workspace se construye mediante **muestreo aleatorio
uniforme** del espacio de configuraciones articulares. Un `MonteCarloBuilder`
genera N configuraciones aleatorias (10,000 por defecto), calcula su
cinemática directa, estima métricas, y agrupa los resultados:

```
MonteCarloBuilder::build()
1. Semilla determinista (42) → reproducibilidad
2. Generar N configuraciones q aleatorias
3. Para cada q: FK → estimar manipulabilidad
4. Detectar zonas de singularidad por agrupamiento
5. Identificar configuraciones preferidas (top 5%)
6. Devolver WorkspaceKnowledge
```

**¿Es esto IA?** No durante la planificación. El Monte Carlo es un
**mecanismo para construir la base de conocimiento**, no un proceso de
razonamiento. Es una técnica de simulación numérica que genera los datos
que luego usarán los componentes de IA (PlanAdvisor, RepairPlanner).

La "inteligencia" no está en el muestreo, sino en:
- Lo que se decide muestrear (las dimensiones relevantes del espacio).
- Cómo se estructuran los resultados (zonas, mapas, campos).
- Cómo se consulta ese conocimiento posteriormente para tomar decisiones.

Presentarlo como "Monte Carlo = IA" sería fácil de cuestionar por un
revisor. Es más preciso decir: *el Monte Carlo es el método de
construcción de la base de conocimiento que la IA consulta*.

---

## 10. Lo Que NO Está Presente (y por qué importa)

Tan importante como identificar qué técnicas de IA clásica están
presentes es reconocer cuáles **no** lo están. Esto evita exageraciones
y fortalece el análisis:

| Técnica de IA clásica | Ausente en Thalos | Explicación |
|---|---|---|
| **STRIPS / PDDL** | No hay | El dominio es continuo (articulaciones ℝⁿ), no discreto. La planificación es geométrica, no lógica proposicional. |
| **A\* o Dijkstra** | No hay | No hay grafo de configuraciones discretas. El espacio articular se muestrea directamente sin discretización. |
| **HTN (Hierarchical Task Network)** | No hay | El plan es una secuencia plana de segmentos, sin descomposición jerárquica de tareas. |
| **Razonamiento no monotónico** | No hay | Toda la inferencia es deductiva y monotónica: nuevos hechos no invalidan hechos anteriores (a diferencia de, por ejemplo, sistemas de creencias con revisión). |
| **Lógica de primer orden** | No hay | Las reglas son proposicionales (comparación de tipos), sin cuantificadores, unificación ni resolución. |
| **Sistemas BDI (Creencias-Deseos-Intenciones)** | No hay | El robot no tiene creencias, deseos ni intenciones. Solo ejecuta planes generados por el sistema. |
| **Aprendizaje automático / redes neuronales** | No hay | Ningún componente requiere entrenamiento con datos. Todos los parámetros son fijos o configurables manualmente. |
| **Redes bayesianas / incertidumbre** | No hay | Todo el sistema es determinista. No hay distribuciones de probabilidad ni inferencia probabilística. |
| **Algoritmos evolutivos** | No hay | No hay optimización genética ni poblaciones de soluciones. |

La ausencia de estas técnicas no es una limitación; refuerza el carácter
de **IA simbólica en estado puro**: Thalos resuelve el problema de
planificación de movimiento mediante geometría analítica, búsqueda
determinista, conocimiento explícito, reglas de producción y funciones
heurísticas —técnicas fundacionales de la IA que siguen siendo
perfectamente válidas para dominios donde el conocimiento es completo,
el espacio es continuo y el determinismo es un requisito.

---

## 11. Conclusiones

El sistema de planificación de Thalos implementa un subconjunto
significativo de las técnicas fundacionales de la inteligencia
artificial simbólica. Siguiendo el ciclo clásico de la IA:

| Etapa del ciclo | Componente Thalos | Técnica de IA |
|---|---|---|
| **Percepción** | TrajectoryAnalyzer | Generación de hechos (Findings) a partir de datos sensoriales simulados |
| **Representación del conocimiento** | PlanningKnowledge, RobotGraph | Conocimiento declarativo explícito, inspeccionable y reutilizable |
| **Razonamiento** | PlanAdvisor (reglas), RepairPlanner (heurísticas) | Sistema experto basado en reglas de producción + resolución de problemas con heurísticas |
| **Planificación** | MotionPlanner, PlanCompiler | Planificación jerárquica multi-segmento con validación de metas |
| **Acción** | Execution Runtime | Ejecución del plan (infraestructura de control) |

El sistema también se distingue por lo que **no** hace: no usa STRIPS,
PDDL, A\*, HTN, BDI, redes bayesianas ni aprendizaje automático. Esto
no es una carencia sino una decisión de diseño: Thalos resuelve su
dominio (un robot 2GDL con espacio de trabajo conocido) con las
herramientas adecuadas de la IA clásica, sin recurrir a técnicas más
complejas de las necesarias.

### Referencias

- Newell, A., & Simon, H. A. (1976). Computer science as empirical
  inquiry: Symbols and search. *Communications of the ACM*, 19(3),
  113–126.
- Nilsson, N. J. (1998). *Artificial Intelligence: A New Synthesis*.
  Morgan Kaufmann.
- Russell, S., & Norvig, P. (2021). *Artificial Intelligence: A Modern
  Approach* (4th ed.). Pearson.
- Luger, G. F. (2008). *Artificial Intelligence: Structures and
  Strategies for Complex Problem Solving* (6th ed.). Addison-Wesley.
- Jackson, P. (1998). *Introduction to Expert Systems* (3rd ed.).
  Addison-Wesley.
