# Thalos

Plataforma modular para modelado, análisis y visualización de sistemas robóticos.

## Stack

| Capa | Tecnología |
|------|------------|
| Core | Rust 2024, `nalgebra` |
| Visual | `thalos-visual` (scene graph desacoplado) |
| Runtime | `thalos-runtime` (orquestación, commands, backends) |
| API | `axum` 0.8 |
| Frontend | Angular 19 + Three.js |

## Crates

```
thalos-core     → Matemática + robótica (sin dependencias externas pesadas)
thalos-visual   → Representación visual, validación, primitivas 3D
thalos-runtime  → Orquestación, estado mutable, commands
thalos-api      → HTTP, DTOs, routing
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
