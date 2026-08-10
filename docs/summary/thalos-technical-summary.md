# Thalos — Resumen Técnico del Sistema

> Documento de síntesis técnica para presentación de Thalos como plataforma
> robótica modular. Orientado a perfiles técnicos: ingenieros, arquitectos de
> software y reclutadores especializados.

---

## ¿Qué es Thalos?

Thalos es una **plataforma modular para modelado, análisis cinemático,
planificación de movimiento y visualización de robots seriales** (brazos
manipuladores). Escrita completamente en Rust (edition 2024), está diseñada
desde cero con una filosofía de separación estricta de responsabilidades: el
núcleo matemático no sabe que existe la visualización, y la visualización no
sabe que existe una API HTTP.

No es un framework de control en tiempo real (como ROS 2), ni un simulador
físico (como Gazebo). Es una **capa intermedia de representación y análisis**
que puede integrarse en sistemas más grandes o usarse como herramienta
autónoma de validación.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| Lenguaje | Rust (edition 2024) |
| Álgebra lineal | `nalgebra` + tipos propios |
| Backend HTTP | `axum` 0.8, `tokio` |
| Frontend | React 19 + TypeScript + Vite, Three.js (@react-three/fiber) |
| Visualización | Scene graph desacoplado (`thalos-visual`) |
| Persistencia de documentación | Quarto |
| Testing visual | `insta` (snapshot testing) |

---

## Arquitectura: 8 Crates Desacoplados

```
thalos-math      → Tipos vectoriales puros (Vector3, Quaternion, Transform3D)
thalos-core      → Robótica: joints, links, cadenas, FK, IK, jacobianos, frames
thalos-models    → Estructura canónica de robot (URDF mirror, parser)
thalos-collision → Detección de colisiones (SAT, O(n²), esferas/cajas)
thalos-planning  → Planificadores MoveJ/MoveL, trayectorias, evaluación
thalos-visual    → Escenas 3D serializables, validación, diff, snapshots
thalos-runtime   → Orquestación, estado mutable, comandos, ejecución
thalos-api       → HTTP, DTOs, routing (axum)
```

Cada crate tiene un **contrato de dependencias** explícito y validable:

- `thalos-math` no depende de nada fuera de `nalgebra`.
- `thalos-core` no sabe que existe HTTP ni visualización.
- `thalos-runtime` no sabe que existe HTTP.
- `thalos-api` no contiene lógica de dominio — solo orquesta.

Esta arquitectura permite compilar y testear el núcleo matemático-robótico
**sin GPU, sin navegador, sin dependencias gráficas**.

---

## Capacidades Técnicas

### 1. Modelado Cinemático

- **Serial Chains**: secuencias ordenadas de segmentos (joint + link) con
  registro explícito de frames espaciales.
- **Joints**: revolutos (rotacionales) y prismáticos (deslizamiento), cada uno
  con límites físicos y transformación local.
- **Frames como ciudadanos de primera clase**: `FrameId`, `FrameRegistry` con
  IDs auto-incrementales, validación contra frames huérfanos.
- **Sistema de poses**: relación espacial explícita entre dos frames, con
  `Transform3D` y verificación de consistencia.
- **Tool Center Point (TCP)**: separación flange/herramienta con offset
  configurable en runtime (ADR-0002).
- **8 modelos de robot incorporados**: Planar2R, Planar3R, SingleRevolute,
  SCARA, Manipulator3DOF, Manipulator6DOF, CylindricalRPP, SphericalPolarRRP.

### 2. Cinemática

- **Forward Kinematics (FK)**: composición secuencial de transformaciones a
  lo largo de la cadena. Produce `FKResult` con poses globales de cada frame.
- **Jacobiano Geométrico**: analítico, basado en producto cruz
  `zᵢ × (pₑ − pᵢ)` para velocidad lineal y `zᵢ` para angular.
- **Jacobiano Numérico**: diferencias finitas centrales, validación cruzada
  contra el geométrico.
- **Inverse Kinematics (IK)**:
  - **Damped Least Squares (DLS)**: robusto cerca de singularidades, damping
    `λ` configurable. Solver por defecto.
  - **Jacobian Transpose (JT)**: más rápido computacionalmente, menos preciso.
  - Metas: posición y pose completa. Resultado con error residual, iteraciones
    y estado (Converged, MaxIterationsReached, Singularity).

### 3. Planificación de Movimiento

- **MoveJ**: interpolación sincronizada en joint space con rampas de
  velocidad trapezoidal.
- **MoveL**: trayectoria en línea recta del end-effector en cartesian space
  (con resolución IK por waypoint).
- **PlanCompiler**: planificador jerárquico que compila programas multi-segmento
  con atomicidad (todo o nada).
- **GoalResolver**: validación de metas contra políticas de planificación
  (límites articulares, strict_limits).
- **Trajectory**: secuencia de waypoints con metadatos (tipo de movimiento,
  timestamps, duración total, distancia).
- **Interpoladores**: perfiles trapezoidales, `lerp`/`slerp` para
  interpolación lineal y esférica.

### 4. Evaluación de Planes (Expert Planning Assistant)

- **PlanMetrics**: vector de calidad en 6 dimensiones (longitud, manipulabilidad,
  margen articular, riesgo de colisión, suavidad, cambio de orientación).
- **CostFunction**: combinación lineal ponderada con desglose por métrica.
- **AlternativeGenerator**: perturbación determinista (±δ) alrededor de
  waypoints problemáticos para generar alternativas rankeadas.
- **API**: `POST /plan/analyze`, `POST /plan/analyze/alternatives`.

### 5. Sistema Experto Basado en Reglas

- **TrajectoryAnalyzer**: produce hechos objetivos (Findings) a partir de
  datos geométricos — manipulabilidad, singularidades, colisiones, violaciones
  de constraints.
- **PlanAdvisor**: sistema experto con reglas de producción. Cada regla sigue
  la forma `SI <patrón> ENTONCES <acción>`. Encadenamiento hacia adelante
  (forward chaining).
- **RepairPlanner**: resolución de problemas con generación y ranking de
  estrategias de reparación (LiftTcp, RotateTool, SplitSegment).
- **Separación hecho/recomendación**: el Analyzer produce hechos (geometría
  deductiva), el Advisor produce recomendaciones (inferencia basada en reglas).

### 6. Detección de Colisiones

- **NaiveCollisionChecker**: O(n²), compara todos los pares de objetos.
- **SAT** (Separating Axis Theorem): intersección entre cajas orientadas (OBB).
- **Intersecciones**: esfera-esfera, esfera-caja, caja-caja.
- **Clasificación semántica**: self-collision vs environment-collision.

### 7. Análisis de Workspace

- **Muestreo Monte Carlo**: configuraciones articulares uniformes dentro de
  límites, con semilla determinista para reproducibilidad.
- **Reachability**: consulta de alcanzabilidad con distancia al punto más
  cercano.
- **Singularidad**: detección basada en condition number del jacobiano.
- **Manipulabilidad**: índice de Yoshikawa.
- **WorkspaceService**: servicio stateless que orquesta muestreo y consultas.
- **~9 endpoints REST** para sampleo, bounds, análisis completo, reachability,
  singularidad y manipulabilidad.

### 8. Visualización Desacoplada

- **VisualScene**: representación serializable (`Serialize`/`Deserialize`) con
  frames, links, ejes de joints y twists jacobianos. Sin tipos del core — usa
  `[f64; 3]` y `[f64; 4]`.
- **SceneBuilder**: traducción unidireccional `FKResult → VisualScene`.
- **SceneValidator**: 8 invariantes (world frame, IDs únicos, parents existen,
  sin ciclos, conectividad, valores finitos, norma de quaternions, links
  consistentes).
- **SceneDiff**: detección de frames agregados, eliminados y modificados
  (delta de traslación y ángulo geodésico).
- **VisualPrimitive**: cilindros, esferas, cajas con posición y rotación para
  modelos 3D concretos.
- **FrameStyle**: personalización visual por frame (longitud/radio de ejes,
  colores RGB, etiquetas).
- **Snapshots con `insta`**: validación visual en CI.

### 9. Runtime y Orquestación

- **SceneService**: orquestador central con `RwLock<SceneRuntime>`.
  Expone `snapshot()` y `execute(Command)` como punto único de entrada para
  toda mutación.
- **Command pattern**: `SetJoints`, `LoadRobot`, `LoadUrdfRobot`,
  `SelectToolFrame`, `Kinematics(MoveToPosition/Pose)`, `Motion(MoveJ,
  PlanAndMoveJ, PlanAndMoveL)`.
- **Pipeline por comando**: mutación → FK → SceneBuilder → SceneValidator →
  RuntimeSnapshot.
- **Plan/session state machines**: `PlanState` (Created→Active→Paused→Completed/
  Cancelled/Failed) y `SessionStatus` (Ready→Running→Paused→Completed/
  Cancelled/Failed).
- **RobotBackend trait**: strategy pattern para resolución de modelos — hoy
  `InternalBackend` (catálogo built-in), extensible a hardware, archivos o red.

### 10. API HTTP (~30 Endpoints REST)

- Scene: snapshot, joints, robot, URDF, TCP, IK solve, motion lifecycle.
- Robots: catálogo, metadata.
- Motion: MoveJ/MoveL directos.
- Workspace: sampleo, bounds, análisis, reachability, singularidad,
  manipulabilidad.
- Plan: análisis, alternativas.
- Mapa de errores sistemático: cada error de dominio tiene código HTTP y
  código de error específico. Sin errores genéricos.

### 11. Frontend React 19

- **Workflow guiado por registro**: los workspaces (Robot, Escena, Programación,
  Evaluación, Ejecución, Sesiones, Configuración, Analysis) derivan de
  `WORKSPACE_REGISTRY` — rutas, guards y stepper comparten una única fuente de
  verdad declarativa.
- **Arquitectura UX**: `AppShell` con top bar, stepper, panel del workspace y
  viewport 3D persistente (no se desmonta al navegar entre workspaces) más
  barra de estado.
- **useSceneStore** (zustand): estado del viewport actualizado desde el
  `RuntimeStateResponse` del backend vía `applyScene()` y `applyFkUpdate()`.
- **SceneCanvas** (@react-three/fiber): `<Canvas>` Z-up con `OrbitControls`;
  renderiza `RobotModel`, `IkGizmo`, `TcpOverlay`, `PointCloud` y `Trajectory`.
- **Adapter** (`features/viewport/adapter.ts`): traducción snake_case (Rust) →
  camelCase (React) con `toSceneData()`, `toRuntimeInfo()`, etc.

### 12. Sistema de Coordenadas Canónico (Z-up)

- Toda FK, IK, planning, workspace analysis y URDF import opera en Z-up
  (ADR-0001).
- URDF import es passthrough puro — sin conversión.
- Three.js configurado explícitamente a Z-up.
- Migración completa con 238 tests de librería y 23 de integración.

---

## Madurez del Sistema

| Área | Estado |
|------|--------|
| `thalos-math` | **Estable** — API congelada |
| `robot::joint`, `link`, `segment`, `serial_chain` | **Estable** |
| `kinematics::forward` | **Estable** — probado vía snapshots |
| `kinematics::inverse::DLS` | **En desarrollo** — funcional |
| `kinematics::inverse::JT` | **Experimental** |
| `spatial::frame`, `pose`, `registry` | **Estable** |
| `thalos-visual::scene`, `validator`, `diff` | **Estable** |
| `thalos-runtime::scene`, `commands` | **En desarrollo** |
| Frontend: Scene, Robots, Execution | **En desarrollo** |
| Planning Assistant (M5) | **Completado** — evaluation, alternativas |
| Frontend: SceneCanvas (R3F) | **Estable** |

Estados: Estable (API congelada) / En desarrollo (funcional, puede cambiar) /
Experimental (implementación inicial).

---

## Dirección Futura

- **Scene como tipo de primer orden** — unificar robots, obstáculos,
  herramientas y frames (Roadmap Fase 1).
- **Execution pipeline** — ejecutar motion plans sobre el scene con estados
  observables (Fase 2).
- **Eventos push** — reemplazar polling por SSE/WebSocket (Fase 3).
- **SimulationController** — ejecución de trayectorias sobre el modelo
  cinemático (Fase 4, hacia MVP).
- **Integración hardware** — brazos robóticos reales via ROS 2, EtherCAT,
  o APIs propietarias.
- **Constraint System** — restricciones simbólicas (orientación, cajas
  cartesianas, composición AND).
- **Evaluation Engine** — sistema unificado de costos multi-objetivo con
  pesos configurables.
- **Robots paralelos, árboles cinemáticos, dinámica** — extensiones
  arquitectónicamente preparadas.

---

## Filosofía de Diseño

1. **Separar para evolucionar**: cada capa puede crecer, reemplazarse o
   eliminarse sin afectar a las demás.
2. **Validación por contrato**: invariantes se validan en construcción, no hay
   fallbacks silenciosos.
3. **Errores explícitos**: `normalize()` e `inverse()` retornan `Result`.
4. **Sin dependencias circulares**: `math → core → visual → runtime → api`.
5. **DTOs separados del dominio**: los tipos serializables son independientes
   de los tipos del core.
6. **Determinismo**: misma entrada produce siempre la misma salida.
7. **Explicabilidad**: cada decisión es trazable a los hallazgos que la
   originaron.
