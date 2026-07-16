# Thalos Intelligent Planning Architecture

Esta carpeta contiene la arquitectura completa del asistente inteligente de planificación de Thalos.

## Documentos

### [Visión](vision.md)
Qué es Thalos, identidad del producto, usuarios objetivo, filosofía, y fuera del alcance.

**Lee esto primero** si querés entender qué es Thalos y hacia dónde va.

### [Roadmap](roadmap.md)
Feature MVP, fases (Comprender, Mejorar, Restringir, Automatizar, Aprender, Adaptarse, Supervisar), cronograma, y entregables.

**Lee esto** si querés saber qué se va a implementar y cuándo.

### [Arquitectura](architecture/planning-assistant.md)
Pipeline central, componentes por capability, dependencias, integración con el motor, y testing strategy.

**Lee esto** si querés entender cómo se implementa cada capability.

### [Especificaciones](specs/)
Especificaciones funcionales de cada capability.

- [Analyze Plan](specs/analyze-plan.md) — especificación funcional del Feature MVP

**Lee esto** si querés ver requisitos detallados, flujos de usuario, y criterios de aceptación.

## ADRs relacionados

Decisiones arquitectónicas registradas en [`docs/adr/`](../adr/):

- [ADR-0003: Constraint System](../adr/ADR-0003-constraint-system.md)
- [ADR-0004: Evaluation Engine](../adr/ADR-0004-evaluation-engine.md)
- [ADR-0005: Planning Assistant](../adr/ADR-0005-planning-assistant.md)

## Resumen rápido

**Thalos es una plataforma de planificación robótica cuyo asistente inteligente actúa como un copiloto para el ingeniero.**

### Dos productos en uno

- **Producto A (Motor)**: URDF → FK → IK → Planning → Runtime → Execution
- **Producto B (Asistente)**: Analyze → Advise → Explain → Optimize → Learn → Adapt

### Capabilities como verbos

| Usuario pregunta | Sistema responde |
|------------------|------------------|
| ¿Está bien mi plan? | **Analyze** |
| ¿Cómo mejorarlo? | **Advise** |
| ¿Por qué elegiste esto? | **Explain** |
| ¿Cuál es la mejor opción? | **Optimize** |
| ¿Qué aprendimos? | **Learn** |
| ¿Cómo reaccionar a fallos? | **Adapt** |

### Filosofía

**La IA es el medio, no el producto.**

El usuario nunca piensa en "Constraint Engine" o "Evaluation Engine". Piensa en "mover esta pieza de A a B priorizando seguridad".

## Empezar por aquí

1. **Entender la visión**: [vision.md](vision.md)
2. **Ver el roadmap**: [roadmap.md](roadmap.md)
3. **Entender la arquitectura**: [architecture/planning-assistant.md](architecture/planning-assistant.md)
4. **Ver especificación del MVP**: [specs/analyze-plan.md](specs/analyze-plan.md)
5. **Leer ADRs**: [ADR-0003](../adr/ADR-0003-constraint-system.md), [ADR-0004](../adr/ADR-0004-evaluation-engine.md), [ADR-0005](../adr/ADR-0005-planning-assistant.md)

## Estado actual

- **Feature MVP (Analyze Plan)**: Planificado
- **Fase 1 (Comprender)**: Planificado
- **Fase 2 (Mejorar)**: Planificado
- **Fase 3 (Restringir)**: Planificado
- **Fase 4 (Automatizar)**: Planificado
- **Fase 5 (Aprender)**: Planificado
- **Fase 6 (Adaptarse)**: Condicional
- **Fase 7 (Supervisar)**: Post-MVP

**Total estimado**: 18-24 semanas para Feature MVP + Fases 1-5

## Contribuir

Si querés contribuir a este roadmap:

1. Leé la [visión](vision.md) para entender el producto
2. Leé el [roadmap](roadmap.md) para ver qué sigue
3. Leé la [arquitectura](architecture/planning-assistant.md) para entender cómo
4. Implementá según las [especificaciones](specs/)
5. Seguí los [ADRs](../adr/) para decisiones arquitectónicas

## Contacto

Para preguntas sobre este roadmap:
- Abrí un issue en GitHub
- Consultá la [documentación general](../README.md)
- Revisá los [ADRs](../adr/) para decisiones técnicas
