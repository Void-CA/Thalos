# Thalos Intelligent Planning Architecture — Visión

## Qué es Thalos

**Thalos es una plataforma de planificación robótica cuyo asistente inteligente actúa como un copiloto para el ingeniero.**

Thalos combina simulación, planificación y asistencia inteligente en una única plataforma. No se limita a ser un simulador, pero sí contiene uno. No es un controlador industrial, pero puede integrarse con ellos.

## Dos Productos en Uno

### Producto A — Plataforma de Robótica (el motor)

```
URDF → FK → IK → Planning → Runtime → Execution
```

Infraestructura técnica que provee capacidades fundamentales de cinemática, planificación y ejecución. Es lo que Thalos ya tiene hoy.

### Producto B — Asistente Inteligente (la experiencia)

```
Analyze → Advise → Explain → Optimize → Learn → Adapt
```

Capa de inteligencia que consume el motor y agrega valor mediante análisis, recomendaciones, explicaciones y optimización. Es lo que este roadmap construye.

**Relación de dependencia**: El Producto B depende del Producto A, nunca al revés.

## Identidad del Producto

Las capacidades del asistente son verbos que responden a preguntas del usuario:

| Usuario pregunta | Sistema responde | Capability |
|------------------|------------------|------------|
| ¿Está bien mi plan? | Análisis de viabilidad | **Analyze** |
| ¿Cómo mejorarlo? | Recomendaciones | **Advise** |
| ¿Por qué elegiste esto? | Justificación | **Explain** |
| ¿Cuál es la mejor opción? | Optimización | **Optimize** |
| ¿Qué aprendimos? | Ajustes basados en historial | **Learn** |
| ¿Cómo reaccionar a fallos? | Adaptación automática | **Adapt** |

Esta tabla no es casualidad. Es la identidad del producto.

## Filosofía

**Principio rector**: La IA es el medio, no el producto. El usuario nunca debe pensar en "Constraint Engine" o "Evaluation Engine". Piensa en "mover esta pieza de A a B priorizando seguridad".

**Principio arquitectónico**: No construir componentes porque "están en el roadmap". Cada nuevo componente debe habilitar una capability visible para el usuario. La arquitectura crece impulsada por funcionalidades de producto, no por acumulación de infraestructura.

**Inversión de prioridades**: La pregunta no es "¿implementamos Gaussian Processes?", sino "¿qué necesita el usuario para tomar mejores decisiones?". Recién después elegimos la técnica: reglas, optimización, heurísticas, métodos bayesianos, o aprendizaje.

## Usuarios Objetivo

| Capability | Usuario | Qué espera |
|------------|---------|------------|
| Analyze | Estudiante de robótica | Ver si un movimiento es correcto |
| Advise | Integrador de sistemas | Encontrar trayectoria mejor sin ajustar parámetros |
| Optimize | Ingeniero de automatización | Definir restricciones de producción |
| Automate | Desarrollador de aplicaciones | Trabajar con tareas de alto nivel |
| Learn | Operador / mantenimiento | Aprender del comportamiento real |
| Adapt | Integrador industrial | Supervisar hardware y adaptarse a fallos |

## Fuera del Alcance

Thalos **NO**:

- No reemplaza un PLC
- No realiza control PID
- No ejecuta control en tiempo real
- No reemplaza firmware
- No es un sistema de visión artificial
- No utiliza modelos generativos para planificar
- No simula física (dinámica, fuerzas, contacto)
- No reemplaza ROS 2
- No es un renderer 3D (delega a Three.js)

Thalos **SÍ**:

- Es una plataforma de planificación robótica basada en conocimiento
- Analiza, planifica, optimiza y explica movimientos
- Propone alternativas y justifica decisiones
- Aprende de ejecuciones anteriores
- Se adapta a restricciones y fallos
- Contiene simulación estructural (cinemática + visualización)

## Evolución del Producto

Thalos evoluciona en tres niveles de interacción con el usuario:

**Nivel 1 — Asistencia**: Thalos valida y analiza lo que el usuario hace

**Nivel 2 — Automatización**: Thalos propone alternativas y genera trayectorias automáticamente

**Nivel 3 — Colaboración**: Thalos se convierte en un asistente de planificación que explica opciones y justifica decisiones

En ese punto, la IA deja de ser un conjunto de algoritmos internos y se convierte en una característica visible del producto.
