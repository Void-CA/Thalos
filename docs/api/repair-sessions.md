# Repair Sessions API

Las sesiones de reparación permiten un flujo interactivo: crear sesión → preview → aplicar → undo.

## POST /api/v1/repair/sessions

Crea una sesión a partir del plan activo.

### Response (201 Created)

```json
{
  "session_id": 1
}
```

## POST /api/v1/repair/sessions/{id}/preview

Evalúa una estrategia sin modificar el plan.

### Request

```json
{
  "region_id": 0,
  "strategy": "lift-tcp"
}
```

### Response

```json
{
  "candidate_id": 0,
  "base_revision": 0,
  "continuity_ok": true,
  "improvement": 0.12
}
```

## POST /api/v1/repair/sessions/{id}/apply

Aplica una reparación. Incrementa la revisión.

### Request

```json
{
  "candidate_id": 0
}
```

### Response

```json
{
  "new_revision": 1,
  "status": "accepted",
  "history_length": 1
}
```

## POST /api/v1/repair/sessions/{id}/undo

Deshace la última reparación. Reconstruye desde original_plan.

### Response

```json
{
  "new_revision": 0,
  "status": "undo_success",
  "history_length": 0
}
```

## DELETE /api/v1/repair/sessions/{id}

Descarta la sesión.

### Response: 204 No Content
