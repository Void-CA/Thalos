# Analysis API

## POST /api/v1/plan/analyze

Analiza el plan activo y devuelve métricas, hallazgos y regiones problemáticas.

### Request

```json
{
  "plan_id": "optional-plan-id"
}
```

El body es opcional en la práctica: `plan_id` (opcional) selecciona un plan; si se omite, se analiza el plan activo del runtime. Un `{}` vacío funciona.

### Response

```json
{
  "artifact": { "kind": "MotionPlan", "id": "plan-0" },
  "observations": [
    {
      "id": 1,
      "kind": "LowManipulability",
      "severity": "Warning",
      "artifact": { "kind": "MotionPlan", "id": "plan-0" },
      "location": { "Waypoint": 0 },
      "attributes": { "threshold": { "Number": 0.3 }, "value": { "Number": 0.0 } },
      "causes": [],
      "related": []
    }
  ],
  "actions": [
    { "id": 1, "kind": "Manipulability", "target_observation": 1, "priority": "High", "impact": "High", "parameters": {} }
  ],
  "metrics": {
    "avg_manipulability": 0.19,
    "has_collisions": 0.0,
    "min_manipulability": 0.0,
    "near_singular_count": 39.0,
    "singular_count": 17.0,
    "trajectory_duration": 3.55,
    "waypoint_count": 241.0
  },
  "summary": {
    "quality_index": 0.0,
    "score": 0,
    "grade": "Poor",
    "observation_count": 57,
    "severity_distribution": { "Error": 17, "Warning": 40 }
  },
  "problem_regions": [
    {
      "id": 0,
      "kind": "low_manipulability",
      "severity": "warning",
      "waypoint_start": 0,
      "waypoint_end": 0,
      "waypoint_count": 1,
      "metrics": { "waypoint_count": 1, "average_value": 0.0, "min_value": 0.0, "max_value": 0.0, "error_count": 0, "warning_count": 1 },
      "explanation": { "cause": "...", "consequence": "...", "recommended_strategies": ["Switch IK solver", "Lift TCP", "Insert waypoint"], "confidence": 1.0 }
    }
  ],
  "manipulability_series": [
    { "waypoint": 0, "yoshikawa": 0.0 },
    { "waypoint": 1, "yoshikawa": 0.000012 }
  ],
  "recommendations": [
    {
      "id": 1,
      "action": { "id": 1, "kind": "Manipulability", "target_observation": 1, "priority": "High", "impact": "High", "parameters": {} },
      "edit": { "ReplaceSegment": { "index": 0, "replacement": [ { "MoveJ": { "origin": "manual", "target": [0.5, -0.3, -0.1, 0.0], "max_velocity": null, "max_acceleration": null } } ], "original": [] } },
      "status": "available"
    }
  ]
}
```

### Notas

- `observations` son las observaciones canónicas machine-readable (con `id` 1-based) — el componente principal del reporte
- `recommendations` son acciones de remediación; cada una lleva `action` + `edit` (comando semántico de plan). Su `id` es el que se pasa a `/plan/commands/preview` y `/plan/commands/apply`
- `problem_regions`, `manipulability_series` y `recommendations` son aditivos (`skip_serializing_if` cuando vacíos) — clientes viejos no se rompen

## POST /api/v1/plan/repair/options

Lista reparaciones disponibles para las regiones del plan activo.

### Response

```json
{
  "repairs": [
    {
      "region_id": 0,
      "strategy": "lift-tcp",
      "status": "available",
      "improvement": 0.12,
      "metrics_before": { "manipulability": 0.13, "smoothness": 0.5 },
      "metrics_after": { "manipulability": 0.25, "smoothness": 0.48 }
    }
  ]
}
```
