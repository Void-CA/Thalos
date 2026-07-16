# Frontend — Thalos

Cliente Angular para la plataforma Thalos. Renderizado 3D con Three.js,
estado reactivo con Signals + RxJS.

## Stack

- Angular 21
- Three.js 0.184
- RxJS 7.8
- pnpm 10.x
- TypeScript 5.9

## Development server

```bash
pnpm start
# o
ng serve
```

Navegar a `http://localhost:4200/`. La app recarga automáticamente al
modificar archivos fuente.

## Build

```bash
pnpm build
# → dist/
```

## Tests

```bash
ng test        # Vitest
```

## Estructura

```
src/app/
├── app.config.ts          # Providers
├── app.component.ts       # Layout shell (5 zonas)
├── features/
│   ├── scene/             # Visualizador 3D, joint controls, store
│   ├── robots/            # Catálogo de robots
│   ├── planning/          # Planificación de movimiento
│   ├── execution/         # Ejecución de trayectorias
│   └── workspace/         # Workspace analysis
```

## APIs

El frontend se comunica con el backend via REST:

- `GET/POST /api/v1/scene/*` — estado de escena y comandos
- `GET /api/v1/robots` — catálogo de robots
- `POST /api/v1/motion/movej` — movimiento en joint space
- `POST /api/v1/motion/movel` — movimiento en cartesian space
- `POST /api/v1/workspace/*` — análisis de workspace
