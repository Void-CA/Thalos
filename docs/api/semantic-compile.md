# Semantic Compile API

`POST /api/v1/semantic/compile`

Compila un programa de tareas semánticas en un plan de ejecución. Recorre todo el pipeline: validación → lowering → planificación geométrica.

---

## Request

```json
{
  "operations": [
    { "type": "pick",   "object": "bolt", "tool": "gripper-1" },
    { "type": "place",  "object": "bolt", "destination": "tray", "tool": "gripper-1" },
    { "type": "move_to", "destination": "station-2" },
    { "type": "wait",   "duration_secs": 0.5 },
    { "type": "home" }
  ]
}
```

### Operation types

| Type | Required fields | Optional fields |
|------|----------------|-----------------|
| `pick` | `object: string` | `tool: string` |
| `place` | `object: string`, `destination: string` | `tool: string` |
| `move_to` | `destination: string` | `tool: string` |
| `wait` | `duration_secs: number` | — |
| `home` | — | — |

---

## Response (200 OK)

```json
{
  "status": "ok",
  "execution_plan": {
    "segment_count": 2,
    "duration_ms": 5141
  },
  "validation": {
    "errors": [],
    "warnings": []
  },
  "metadata": {
    "instruction_count": 6,
    "planning_time_ms": 6
  }
}
```

| Field | Description |
|-------|-------------|
| `execution_plan.segment_count` | Número de segmentos planificados |
| `execution_plan.duration_ms` | Duración total estimada en milisegundos |
| `validation.errors` | Errores de validación semántica (vacíos en éxito) |
| `validation.warnings` | Advertencias no fatales |
| `metadata.instruction_count` | Instrucciones de movimiento generadas |
| `metadata.planning_time_ms` | Tiempo de compilación en milisegundos |

---

## Errors (422 Unprocessable Entity)

### Semantic validation error

```json
{
  "error": "[Error] Place references object 'bolt' which has no preceding Pick (op: ...)",
  "code": "semantic_validation_error"
}
```
Causa: violación de reglas semánticas (Place sin Pick, Home con args, etc.).

### Knowledge error

```json
{
  "error": "Semantic lowering failed: knowledge provider error: not configured",
  "code": "lowering_error"
}
```
Causa: el programa es semánticamente válido pero el KnowledgeProvider no puede resolver un recurso (objeto, ubicación, etc.).

### Planning error

```json
{
  "error": "Motion planning failed: ...",
  "code": "planning_error"
}
```
Causa: el planificador geométrico no pudo generar una trayectoria (IK failure, programa vacío, etc.).

---

## HTTP status codes

| Code | Meaning |
|------|---------|
| `200` | Compilación exitosa |
| `422` | Error de validación, conocimiento o planificación |

---

## Ejemplos

### Wait + Home

```bash
curl -s -X POST http://localhost:3000/api/v1/semantic/compile \
  -H "Content-Type: application/json" \
  -d '{"operations":[{"type":"wait","duration_secs":0.5},{"type":"home"}]}'
```

### Pick + Place + Home

```bash
curl -s -X POST http://localhost:3000/api/v1/semantic/compile \
  -H "Content-Type: application/json" \
  -d '{"operations":[{"type":"pick","object":"bolt"},{"type":"place","object":"bolt","destination":"tray"},{"type":"home"}]}'
```

### Place sin Pick (error)

```bash
curl -s -X POST http://localhost:3000/api/v1/semantic/compile \
  -H "Content-Type: application/json" \
  -d '{"operations":[{"type":"place","object":"bolt","destination":"tray"}]}'
```
