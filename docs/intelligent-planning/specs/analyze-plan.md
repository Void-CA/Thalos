# Especificación Funcional: Analyze Plan

## Actor

Ingeniero de robótica, estudiante, o integrador de sistemas.

## Objetivo

Entender si un plan de movimiento es seguro y eficiente antes de ejecutarlo.

## Contexto

El usuario ha creado un programa de movimiento (secuencia de MoveJ, MoveL) y quiere validarlo antes de ejecutarlo en el robot (simulado o real).

## Flujo Principal

```
1. Usuario crea programa de movimiento
   - MoveJ a configuración [1.0, 0.5, -0.3]
   - MoveL a pose [x=0.5, y=0.2, z=0.8, roll=0, pitch=0, yaw=0]
   - MoveJ a configuración [0.0, 0.0, 0.0]

2. Usuario presiona botón "Analyze"

3. Frontend envía request al backend
   POST /plan/analyze
   Body: { plan_id: "abc123" }

4. Backend ejecuta pipeline de análisis:
   a. TrajectoryAnalyzer recibe CompiledPlan
   b. ManipulabilityAnalyzer evalúa cada waypoint
   c. SingularityAnalyzer detecta configuraciones singulares
   d. CollisionAnalyzer calcula distancia mínima a obstáculos
   e. ConstraintEvaluator valida restricciones activas
   f. Advisor genera sugerencias basadas en análisis

5. Backend retorna AnalysisReport
   {
     "time_estimated": 4.2,
     "manipulability": {
       "average": 0.72,
       "min": 0.45,
       "min_waypoint": 4
     },
     "singularities": [
       {
         "waypoint": 5,
         "severity": "warning",
         "distance": 0.08
       }
     ],
     "collisions": {
       "min_distance": 0.018,
       "min_distance_waypoint": 7,
       "obstacle_id": "obs_001"
     },
     "constraints": {
       "violations": []
     },
     "suggestions": [
       {
         "type": "ik_solution",
         "message": "Cambiar solución IK aumenta manipulabilidad 15%",
         "impact": "high"
       },
       {
         "type": "velocity",
         "message": "Reducir velocidad máxima a 0.8 m/s mejora suavidad",
         "impact": "medium"
       },
       {
         "type": "waypoint",
         "message": "Agregar waypoint intermedio evita singularidad",
         "impact": "high"
       }
     ]
   }

6. Frontend renderiza resultados:
   ✓ Tiempo estimado: 4.2 s
   ✓ Manipulabilidad promedio: 0.72
   ⚠ Singularidad cerca del waypoint 5 (distancia: 0.08 rad)
   ⚠ Distancia mínima a obstáculo: 18 mm (waypoint 7)
   
   Sugerencias:
   • Cambiar solución IK (aumenta manipulabilidad 15%)
   • Reducir velocidad máxima a 0.8 m/s
   • Agregar waypoint intermedio para evitar singularidad

7. Usuario decide:
   - Ejecutar plan tal cual
   - Aplicar sugerencia (ej: cambiar IK)
   - Editar plan manualmente
```

## Flujos Alternativos

### Flujo A: Plan con violaciones de constraints

```
Paso 4f: ConstraintEvaluator detecta violación
  - Constraint: "TCP debe mantener orientación vertical ±10°"
  - Violación: waypoint 3 tiene orientación 25° fuera de rango

Paso 5: Backend retorna AnalysisReport con violations
  "constraints": {
    "violations": [
      {
        "constraint_id": "orient_vertical",
        "waypoint": 3,
        "violation_magnitude": 15.0,
        "message": "Orientación del TCP excede límite de ±10°"
      }
    ]
  }

Paso 6: Frontend muestra error
  ✗ Restricción violada: orientación del TCP excede límite de ±10° en waypoint 3
  
  Acción requerida:
  • Editar waypoint 3
  • Relajar restricción
  • Re-planificar con restricción activa
```

### Flujo B: Plan con colisión inevitable

```
Paso 4d: CollisionAnalyzer detecta colisión
  - Distancia mínima: -0.005 m (penetración)
  - Waypoint: 8
  - Obstáculo: "obs_002"

Paso 5: Backend retorna AnalysisReport con collision
  "collisions": {
    "min_distance": -0.005,
    "min_distance_waypoint": 8,
    "obstacle_id": "obs_002",
    "collision_type": "environment"
  }

Paso 6: Frontend muestra error crítico
  ✗ Colisión detectada: robot penetra obstáculo "obs_002" en waypoint 8
  
  Acción requerida:
  • Editar trayectoria para evitar obstáculo
  • Re-planificar con constraint de evasión
  • Mover obstáculo
```

### Flujo C: Plan perfectamente válido

```
Paso 5: Backend retorna AnalysisReport sin warnings
  {
    "time_estimated": 2.3,
    "manipulability": { "average": 0.85, "min": 0.78 },
    "singularities": [],
    "collisions": { "min_distance": 0.15 },
    "constraints": { "violations": [] },
    "suggestions": []
  }

Paso 6: Frontend muestra éxito
  ✓ Plan válido
  ✓ Tiempo estimado: 2.3 s
  ✓ Manipulabilidad promedio: 0.85
  ✓ Sin singularidades
  ✓ Distancia mínima a obstáculo: 150 mm
  
  No hay sugerencias de mejora.
```

## Requisitos Funcionales

### RF-1: Análisis de manipulabilidad
- El sistema debe calcular manipulabilidad para cada waypoint
- El sistema debe reportar manipulabilidad promedio y mínima
- El sistema debe identificar waypoint con manipulabilidad mínima

### RF-2: Detección de singularidades
- El sistema debe detectar configuraciones singulares (det(J) ≈ 0)
- El sistema debe reportar distancia a singularidad (en espacio articular)
- El sistema debe clasificar severidad: info (< 0.2 rad), warning (< 0.1 rad), error (< 0.05 rad)

### RF-3: Análisis de colisiones
- El sistema debe calcular distancia mínima entre robot y obstáculos
- El sistema debe reportar distancia mínima y waypoint correspondiente
- El sistema debe detectar colisiones (distancia < 0)
- El sistema debe clasificar tipo de colisión: self-collision, environment-collision

### RF-4: Validación de constraints
- El sistema debe validar cada waypoint contra constraints activos
- El sistema debe reportar violaciones con magnitud
- El sistema debe sugerir acciones correctivas

### RF-5: Generación de sugerencias
- El sistema debe generar sugerencias accionables basadas en análisis
- El sistema debe clasificar impacto: low, medium, high
- El sistema debe priorizar sugerencias por impacto

### RF-6: Latencia
- El análisis debe completarse en < 100ms para trayectorias de 100 waypoints
- El análisis debe completarse en < 500ms para trayectorias de 500 waypoints

### RF-7: Reporte estructurado
- El sistema debe retornar AnalysisReport en formato JSON
- El reporte debe incluir: tiempo, manipulabilidad, singularidades, colisiones, constraints, sugerencias
- El reporte debe ser serializable y cacheable

## Requisitos No Funcionales

### RNF-1: Extensibilidad
- El sistema debe permitir agregar nuevos analizadores sin modificar TrajectoryAnalyzer
- El sistema debe permitir agregar nuevos tipos de constraints sin modificar ConstraintEvaluator

### RNF-2: Composabilidad
- Los analizadores deben ser independientes y componibles
- El Advisor debe consumir análisis sin conocer implementación interna

### RNF-3: Determinismo
- Mismo plan + misma escena → mismo AnalysisReport
- RNG inyectable para tests deterministas

### RNF-4: Testeabilidad
- Cada analizador debe tener tests unitarios
- TrajectoryAnalyzer debe tener tests de integración
- Endpoints deben tener tests de API

## Casos de Uso

### CU-1: Estudiante valida MoveJ
**Actor**: Estudiante de robótica  
**Objetivo**: Verificar que MoveJ no tiene singularidades  
**Resultado**: Recibe reporte con ✓ sin singularidades, manipulabilidad 0.72

### CU-2: Integrador detecta colisión cercana
**Actor**: Integrador de sistemas  
**Objetivo**: Asegurar que trayectoria no colisiona con obstáculos  
**Resultado**: Recibe warning ⚠ distancia mínima 18 mm, decide agregar waypoint intermedio

### CU-3: Ingeniero valida restricciones de producción
**Actor**: Ingeniero de automatización  
**Objetivo**: Verificar que TCP mantiene orientación vertical  
**Resultado**: Recibe error ✗ violación de constraint en waypoint 3, edita plan

### CU-4: Usuario aplica sugerencia de IK
**Actor**: Integrador de sistemas  
**Objetivo**: Mejorar manipulabilidad del plan  
**Resultado**: Recibe sugerencia "cambiar solución IK", aplica, re-analiza, manipulabilidad sube de 0.72 a 0.83

## Wireframe

```
┌─────────────────────────────────────────────────────────┐
│  Planning Panel                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ MoveJ: [1.0, 0.5, -0.3]                         │   │
│  │ MoveL: [0.5, 0.2, 0.8, 0, 0, 0]                 │   │
│  │ MoveJ: [0.0, 0.0, 0.0]                          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [ Execute ]  [ Analyze ]  [ Optimize ]                │
└─────────────────────────────────────────────────────────┘

         ↓ (usuario presiona Analyze)

┌─────────────────────────────────────────────────────────┐
│  Analysis Report                                        │
│  ─────────────────────────────────────────────────────  │
│  ✓ Tiempo estimado: 4.2 s                               │
│  ✓ Manipulabilidad promedio: 0.72                       │
│  ⚠ Singularidad cerca del waypoint 5                    │
│  ⚠ Distancia mínima a obstáculo: 18 mm                  │
│                                                         │
│  Sugerencias:                                           │
│  • Cambiar solución IK (aumenta manipulabilidad 15%)    │
│  • Reducir velocidad máxima a 0.8 m/s                   │
│  • Agregar waypoint intermedio                          │
│                                                         │
│  [ Apply Suggestion 1 ]  [ Edit Plan ]  [ Close ]      │
└─────────────────────────────────────────────────────────┘
```

## Criterios de Aceptación

- [ ] Usuario puede presionar "Analyze" en cualquier plan válido
- [ ] Sistema retorna AnalysisReport en < 100ms (100 waypoints)
- [ ] Reporte incluye: tiempo, manipulabilidad, singularidades, colisiones, constraints
- [ ] Advisor genera al menos 1 sugerencia si hay problemas detectados
- [ ] Frontend renderiza reporte con iconos ✓ ⚠ ✗
- [ ] Usuario puede aplicar sugerencia con un click
- [ ] Tests unitarios para cada analizador
- [ ] Tests de integración para TrajectoryAnalyzer
- [ ] Tests de API para endpoint /plan/analyze
- [ ] Documentación de API actualizada
