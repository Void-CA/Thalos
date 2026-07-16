# thalos-api

**Pregunta que responde:** ¿Cómo se comunica el mundo exterior con el sistema?

Es la capa de transporte: recibe requests HTTP, deserializa JSON en DTOs,
convierte DTOs a comandos de dominio, los envía al runtime, y devuelve la
respuesta serializada.

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/v1/scene` | Snapshot del runtime actual |
| `POST` | `/api/v1/scene/joints` | Mutar joints (`SetJoints`) |
| `POST` | `/api/v1/scene/robot` | Cargar robot de catálogo |
| `POST` | `/api/v1/scene/robot/from-urdf` | Cargar robot desde URDF |
| `POST` | `/api/v1/scene/tcp` | Seleccionar/limpiar TCP |
| `POST` | `/api/v1/scene/move-to-position` | IK: mover frame a posición |
| `POST` | `/api/v1/scene/move-to-pose` | IK: mover frame a pose |
| `POST` | `/api/v1/scene/solve-ik-position` | IK resolver (sin mutar) |
| `POST` | `/api/v1/scene/solve-ik-pose` | IK resolver pose (sin mutar) |
| `POST` | `/api/v1/scene/execute-ik` | IK resolver + aplicar |
| `POST` | `/api/v1/scene/motion/plan` | Compilar plan (preview) |
| `POST` | `/api/v1/scene/motion/start` | Iniciar ejecución |
| `POST` | `/api/v1/scene/motion/pause` | Pausar ejecución |
| `POST` | `/api/v1/scene/motion/resume` | Reanudar ejecución |
| `POST` | `/api/v1/scene/motion/cancel` | Cancelar ejecución |
| `POST` | `/api/v1/scene/motion/reset` | Resetear ejecución |
| `POST` | `/api/v1/scene/motion/tick` | Tick de ejecución (polling) |
| `POST` | `/api/v1/scene/validate` | Validar escena arbitraria |
| `POST` | `/api/v1/scene/diff` | Diff entre dos escenas |
| `GET` | `/api/v1/robots` | Listar catálogo de robots |
| `GET` | `/api/v1/robots/{id}` | Metadata de un robot |
| `POST` | `/api/v1/workspace/sample` | Muestrear workspace |
| `POST` | `/api/v1/workspace/reachability` | Consulta de alcanzabilidad |
| `POST` | `/api/v1/workspace/singularity` | Análisis de singularidad |
| `POST` | `/api/v1/workspace/manipulability` | Análisis de manipulabilidad |
| `POST` | `/api/v1/motion/movej` | Ejecutar MoveJ directo |
| `POST` | `/api/v1/motion/movel` | Ejecutar MoveL directo |

### Endpoints de catálogo

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/v1/robots` | Listar catálogo de robots |

Depende de `thalos-runtime` para ejecutar comandos y de `thalos-visual` para
construir la escena visual a partir del snapshot.

**No debe contener:** solvers de IK, cinemática, tipos geométricos
(Vector3, Quaternion, Transform3D), lógica de validación de escenas. Su única
responsabilidad es orquestar la conversión entre el mundo HTTP/JSON y los
comandos de dominio.
