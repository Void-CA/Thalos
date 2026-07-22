# Analysis API

## POST /api/v1/plan/analyze

Analiza el plan activo y devuelve métricas, hallazgos y regiones problemáticas.

### Request

```json
{
  "plan_id": "optional-plan-id"
}
```

### Response

```json
{
  "summary": { "status": "ok|warning|error", "score": 0..100, "grade": "Excellent|Good|Fair|Poor|Invalid", "message": "..." },
  "metrics": { "duration": 14.7, "waypoint_count": 148, "average_manipulability": 0.37, ... },
  "findings": [{ "kind": "singularity", "severity": "error", "waypoint": 147, "message": "...", "value": 0.02 }],
  "recommendations": [{ "kind": "singularity", "message": "...", "impact": "high", "waypoint": 147 }],
  "problem_regions": [
    {
      "id": 0,
      "kind": "singularity",
      "severity": "critical",
      "waypoint_start": 147,
      "waypoint_end": 227,
      "waypoint_count": 80,
      "metrics": { "error_count": 80, "warning_count": 0 },
      "explanation": { "cause": "...", "consequence": "...", "confidence": 1.0 }
    }
  ],
  "health_score": 0.42
}
```

### Notas

- `problem_regions` aparece en M8.1+ (puede estar vacío)
- `health_score` aparece en M8.1+ (0.0 = peor, 1.0 = mejor)
- Los campos nuevos usan `skip_serializing_if` — clientes viejos no se rompen

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
