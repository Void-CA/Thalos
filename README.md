# Thalos

Plataforma modular para modelado, análisis y visualización de sistemas robóticos.

## Stack

| Capa | Tecnología |
|------|------------|
| Core | Rust 2024, `nalgebra` |
| Matemática | `thalos-math` (vectores, cuaterniones, transforms propios) |
| Colisiones | `thalos-collision` (SAT, esferas, cajas, naive O(n²)) |
| Planificación | `thalos-planning` (planners MoveJ/MoveL, interpolación, trayectorias) |
| Modelos robóticos | `thalos-models` (URDF mirror: Robot, Link, Joint, Geometry) |
| Visual | `thalos-visual` (scene graph desacoplado, validación, diff) |
| Runtime | `thalos-runtime` (orquestación, commands, backends, TCP, IK) |
| API | `axum` 0.8 |
| Frontend | Angular 21 + Three.js 0.184 |

## Crates

```
thalos-core      → Matemática + robótica (sin dependencias externas pesadas)
thalos-math      → Tipos vectoriales puros (Vector3, Quaternion, Transform3D)
thalos-models    → Estructura canónica de robot (URDF mirror)
thalos-collision → Detección de colisiones, SAT, clasificación
thalos-planning  → Planificadores de movimiento, trayectorias, interpolación
thalos-visual    → Representación visual, validación, primitivas 3D, diff
thalos-runtime   → Orquestación, estado mutable, commands, IK, TCP, ejecución
thalos-api       → HTTP, DTOs, routing, workspace analysis
```

## Quick start

```bash
# Backend
cd backend
cargo build
cargo test
cargo run -p thalos_api

# Frontend (en otra terminal)
cd frontend
pnpm install
pnpm start
```

## Documentación

La documentación técnica completa está en [`docs/`](docs/) generada con Quarto.

```
docs/
├── index.qmd          # Intro + stack + quick start
├── vision.qmd         # Propósito, alcance y dirección futura
├── architecture.qmd   # Filosofía arquitectónica y reglas
├── workspace.qmd      # Estructura de crates y frontend
├── domain.qmd         # Definiciones del dominio
├── flow.qmd           # Flujo interno del sistema
├── maturity.qmd       # Estado de madurez
├── contributing.qmd   # Guía de contribución
└── glossary.qmd       # Glosario de términos
```

Decisiones arquitectónicas registradas (ADR) en [`docs/adr/`](docs/adr/).
