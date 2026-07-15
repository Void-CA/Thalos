# ADR-0002: Separación de Flange y TCP (Tool Center Point)

## Estado

Aceptado (2026-07-14)

## Contexto

Históricamente, Thalos trataba el "end effector" como un único concepto: el último frame de la cadena cinemática. Este frame se usaba para:

- Cálculos de workspace
- Análisis de singularidad y manipulabilidad
- Resolución de IK
- Visualización de trayectorias

Sin embargo, en robótica industrial existe una distinción importante:

- **Flange**: El último frame mecánico del robot (donde se monta la herramienta)
- **TCP (Tool Center Point)**: El punto de trabajo de la herramienta activa

Por ejemplo, un robot puede tener:
- Flange en la posición del último joint
- TCP 120mm más abajo (punta de un gripper)
- TCP 200mm más adelante (punta de un soldador)

## Decisión

Separamos el concepto de "end effector" en dos:

1. **Flange** (`SerialChain::end_effector`): El último frame mecánico del robot. Inmutable durante la vida del robot.

2. **TCP activo** (`SceneRuntime::active_tcp`): Un frame opcional que representa la herramienta activa. Puede cambiar en runtime sin reconstruir la cadena cinemática.

### Estructura de datos

```rust
pub struct ToolFrame {
    pub base_frame: FrameId,        // Frame base (ej: flange, tool0)
    pub transform: Transform3D,     // Offset desde base_frame (identidad = sin offset)
}
```

### Invariantes del runtime

El runtime garantiza:

1. Si `active_tcp` es `Some`, entonces `base_frame` existe en la cadena cinemática del robot actualmente cargado.

2. Al cambiar de robot (`LoadRobot`, `LoadUrdfRobot`), `active_tcp` se limpia automáticamente (`None`).

3. La validación del frame ocurre en `SceneRuntime::select_tool_frame()`, no en el dispatcher.

### Impacto en el sistema

Todos los componentes operacionales ahora usan el TCP activo cuando está disponible:

- **Workspace**: Muestrea la posición del TCP, no del flange
- **Jacobiano**: Calcula velocidades lineales respecto al TCP
- **Singularidad/Manipulabilidad**: Analizan el comportamiento en el TCP
- **Planning**: La visualización de trayectorias sigue al TCP
- **IK**: El frame por defecto es el TCP (cuando está seteado)

Cuando `active_tcp` es `None`, el sistema usa el flange (comportamiento anterior).

## Consecuencias

### Positivas

- **Flexibilidad**: Se puede cambiar de herramienta sin reconstruir la cadena cinemática
- **Claridad conceptual**: Separa el hardware (flange) de la herramienta activa (TCP)
- **Consistencia**: Todos los análisis referencian el mismo punto de trabajo
- **Extensibilidad**: Futuro soporte para catálogos de herramientas, tool changers, etc.

### Negativas

- **Complejidad adicional**: Un nuevo concepto que el frontend debe entender
- **Validación requerida**: El runtime debe validar que el TCP referencia un frame válido
- **Limpieza automática**: Cambiar de robot invalida el TCP (comportamiento esperado, pero puede sorprender)

### Neutral

- **Backward compatibility**: Cuando `active_tcp` es `None`, el sistema se comporta como antes
- **API**: Nuevo endpoint `POST /scene/tcp` para seleccionar/limpiar el TCP

## Migración

No requiere migración. El comportamiento por defecto (`active_tcp = None`) es idéntico al anterior.

## Referencias

- Commits: `ff8e642`, `b7823b4`, `4ef3b62`
- Patrón ROS-Industrial: `tool0` frame conectado mediante fixed joint
- Estándar industrial: Flange vs TCP en robots UR5, ABB, KUKA, etc.
