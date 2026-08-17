# Semantic Compile API

`POST /api/v1/semantic/compile`

Compila un programa de tareas semánticas (`TaskDocument`) en un plan de ejecución (`ExecutionProgram`, IR-1). Recorre: validación semántica → lowering con el `KnowledgeProvider` del scene. La planificación geométrica NO ocurre aquí — es un paso posterior (`POST /api/v1/semantic/execute` o `POST /api/v1/scene/motion/plan`).

---

## Request

El body es un objeto `{ "task": TaskDocument }`. El `TaskDocument` es el documento de tarea completo: identidad, metadata, modelo de escena lógico y el programa semántico que referencia recursos del scene por ID.

```json
{
  "task": {
    "id": "smoke-e2e-task",
    "metadata": {
      "name": "Task",
      "version": 1,
      "created_at": "2026-08-05T19:40:00.000Z",
      "modified_at": "2026-08-05T19:40:00.000Z"
    },
    "scene": {
      "objects": [
        { "id": "bolt-1", "name": "Bolt", "category": null, "pose": { "position": [1.8, 0, 0.4], "orientation": [1, 0, 0, 0] } }
      ],
      "locations": [
        { "id": "tray-1", "name": "Tray", "description": null, "pose": { "position": [0.8, -0.3, 0], "orientation": [1, 0, 0, 0] } }
      ],
      "tools": [],
      "home_pose": { "position": [1.8, 0.0, 0.5], "orientation": [0, 0, 0, 1] }
    },
    "program": {
      "operations": [
        { "type": "wait", "origin": "op_0", "duration": { "secs": 2, "nanos": 0 } },
        { "type": "move_to", "origin": "op_1", "destination": "tray-1" }
      ]
    }
  }
}
```

### Estructura del TaskDocument

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único del documento |
| `metadata` | object | `name`, `version`, `created_at`, `modified_at` (ISO 8601) |
| `scene.objects` | array | Objetos físicos del escenario (`id`, `name`, `category`, `pose`) |
| `scene.locations` | array | Ubicaciones lógicas (`id`, `name`, `description`, `pose`) |
| `scene.tools` | array | Herramientas / end-effectors disponibles |
| `scene.home_pose` | object | Pose de home (`position: [x,y,z]`, `orientation: [w,x,y,z]`) |
| `program.operations` | array | Secuencia de operaciones semánticas (ver tabla) |

Los recursos referenciados por las operaciones (objetos, ubicaciones) DEBEN estar declarados en `scene`, o el lowering falla con 422 (`lowering_error`). `pose` usa `orientation` como cuaternión `[w, x, y, z]`.

### Operation types

Toda operación lleva un `origin` (identificador de trazabilidad). Internally-tagged por `type`.

| Type | Campos requeridos | Campos opcionales |
|------|-------------------|-------------------|
| `pick` | `origin: string`, `object: string` | `tool: string \| null` |
| `place` | `origin: string`, `object: string`, `destination: string` | `tool: string \| null` |
| `move_to` | `origin: string`, `destination: string` | `tool: string \| null` |
| `wait` | `origin: string`, `duration: { secs, nanos }` | — |
| `home` | `origin: string` | — |

`duration` usa el shape serde de `std::time::Duration`: `{ "secs": number, "nanos": number }` (nunca un valor float de segundos). `tool` es opcional y puede ser `null`.

---

## Response (200 OK)

```json
{
  "status": "ok",
  "validation": {
    "errors": [],
    "warnings": []
  },
  "metadata": {
    "instruction_count": 2
  },
  "motion_program": {
    "instructions": [
      { "type": "delay", "origin": "op_0", "duration": { "secs": 2, "nanos": 0 } },
      {
        "type": "move_j",
        "origin": "op_1",
        "target": {
          "type": "pose",
          "position": [0.8, -0.3, 0.0],
          "orientation": [1.0, 0.0, 0.0, 0.0],
          "frame": "world"
        },
        "profile": { "max_velocity": 1.0, "max_acceleration": 0.5, "max_jerk": null }
      }
    ],
    "metadata": {
      "schema_version": 1,
      "source_project": "thalos-semantic"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `status` | `"ok"` |
| `validation.errors` | Errores de validación semántica (vacíos en éxito) |
| `validation.warnings` | Advertencias no fatales |
| `metadata.instruction_count` | Instrucciones de movimiento generadas |
| `motion_program` | Programa de ejecución (IR-1) producido por el lowering |

Cada `SemanticOperation` produce las siguientes instrucciones:

| Operation | Instrucciones emitidas |
|-----------|------------------------|
| `pick` | approach (MoveJ) → grasp (MoveL) → grip (SetOutput) → retract (MoveL) |
| `place` | approach (MoveJ) → drop (MoveL) → ungrip (SetOutput) → retract (MoveL) |
| `move_to` | un único MoveJ hacia la pose de la ubicación |
| `wait` | un único Delay con la duración |
| `home` | un único MoveJ hacia el home pose configurado |

---

## Errors (422 Unprocessable Entity)

### Semantic validation error

```json
{
  "error": "[Error] PlaceWithoutPick (op: op_0)",
  "code": "semantic_validation_error"
}
```

Causa: violación de reglas semánticas (Place sin Pick previo, operación desconocida, etc.). El mensaje usa el formato `[{severity}] {Kind} (op: {origin})`; múltiples errores se unen con `; `.

### Knowledge / lowering error

```json
{
  "error": "knowledge provider error: unknown object 'ghost'",
  "code": "lowering_error"
}
```

Causa: el programa es semánticamente válido pero el `KnowledgeProvider` del scene no puede resolver un recurso (objeto, ubicación, etc.).

---

## HTTP status codes

| Code | Meaning |
|------|---------|
| `200` | Compilación exitosa |
| `422` | Error de validación o lowering (body malformado, `task` ausente, violación semántica, recurso desconocido) |

Nota: si el body no incluye `task` (p. ej. `{"operations": []}`), axum rechaza el request con 422 "missing field `task`".

---

## Ejemplos

### Wait + MoveTo (programa completo)

```bash
curl -s -X POST http://localhost:3000/api/v1/semantic/compile \
  -H "Content-Type: application/json" \
  -d '{
    "task": {
      "id": "demo",
      "metadata": { "name": "demo", "version": 1, "created_at": "", "modified_at": "" },
      "scene": {
        "objects": [],
        "locations": [{ "id": "tray-1", "name": "Tray", "description": null, "pose": { "position": [0.8, -0.3, 0], "orientation": [1, 0, 0, 0] } }],
        "tools": [],
        "home_pose": { "position": [1.8, 0.0, 0.5], "orientation": [0, 0, 0, 1] }
      },
      "program": {
        "operations": [
          { "type": "wait", "origin": "op_0", "duration": { "secs": 2, "nanos": 0 } },
          { "type": "move_to", "origin": "op_1", "destination": "tray-1" }
        ]
      }
    }
  }'
```

### Place sin Pick (error)

```bash
curl -s -X POST http://localhost:3000/api/v1/semantic/compile \
  -H "Content-Type: application/json" \
  -d '{
    "task": {
      "id": "demo",
      "metadata": { "name": "demo", "version": 1, "created_at": "", "modified_at": "" },
      "scene": { "objects": [], "locations": [], "tools": [], "home_pose": { "position": [0, 0, 0.5], "orientation": [0, 0, 0, 1] } },
      "program": {
        "operations": [
          { "type": "place", "origin": "op_0", "object": "bolt", "destination": "tray", "tool": null }
        ]
      }
    }
  }'
```

Esperado: `422` con `"code": "semantic_validation_error"`.

### Request inválido (sin `task`)

```bash
curl -s -X POST http://localhost:3000/api/v1/semantic/compile \
  -H "Content-Type: application/json" \
  -d '{"operations":[{"type":"wait","duration":{"secs":0,"nanos":500000000}}]}'
```

Esperado: `422` — el contrato exige `{ "task": TaskDocument }`, no un array `operations` raíz.
