# Resilience Matrix — Thalos MVP (resilience-presentation)

> **Status**: implemented (SDD change `resilience-presentation`, 5 stacked PRs).
> This document is the canonical matrix specification: for each demo failure
> scenario it pins the DETECTION, MESSAGE, CTA, RECOVERY and COHERENT-END-STATE
> contract. Every scenario ends coherently — no infinite spinner, buttons
> re-enabled, `planReady` consistent, immediate retry possible.

## Matrix

| # | Scenario | Detección | Mensaje | CTA | Recuperación | Estado coherente | PR |
|---|----------|-----------|---------|-----|--------------|------------------|----|
| 1 | Backend apagado | ✅ axios rejects → `network_error` code (interceptor, `api-client.ts`) | ✅ "Backend is offline — check the connection and retry" | ✅ "Reintentar" button | ✅ immediate re-fire of the failed operation | ✅ spinner off, buttons re-enabled | 1 |
| 2 | Timeout | ✅ axios timeout 10s (`API_TIMEOUT_MS`) → `timeout_error` code | ✅ "Request timed out — retry or check backend health" | ✅ "Reintentar" button | ✅ immediate retry | ✅ spinner off, buttons re-enabled | 1 |
| 3 | Firmware ausente | ✅ backend returns 400 `no_firmware` (connect handshake fails) | ✅ "No firmware detected — switch to Simulation or check the port" | ✅ "Cambiar a simulación" | ✅ switch to Simulation | ✅ badge updates, retry possible | 2a, 2b |
| 4 | Puerto ocupado | ✅ backend returns 400 `port_in_use` (serial open fails) | ✅ "Port is in use — choose another port or disconnect the other process" | ✅ "Elegir otro puerto" | ✅ port input focused for re-entry | ✅ badge updates, retry possible | 2a, 2b |
| 5 | Robot inexistente | ✅ 404 `not_found` (existing API) | ✅ "Robot not found — return to the catalog" | ✅ "Volver al catálogo" | ✅ re-select from catalog | ✅ spinner off, catalog shown | 1 |
| 6 | Manifest inválido | ✅ 422 `semantic_validation_error` / `lowering_error` / `planning_error` (existing API) | ✅ code→CTA via `describeError` | ✅ "Recompilar" (preview path) | ✅ compile button re-enabled | ✅ `planReady` cleared, retry possible | 1 |
| 7 | Conexión perdida | ✅ backend returns `connection_lost` (serial link drop) | ✅ "Connection lost — reconnect to resume" | ✅ "Reconectar" | ✅ reconnect + retry tick | ✅ execution reset, retry possible | 2a, 2b |

## Component ownership

| Affordance | Component | Behaviour |
|------------|-----------|-----------|
| 10s timeout | `web/src/shared/constants.ts` → `API_TIMEOUT_MS` (single source of truth, NOT env-configurable) | applied to every axios request |
| Network/timeout wrapping | `web/src/shared/api-client.ts` interceptor (`toApiError`) | additive — `isCodedError` (R3-003) untouched |
| Code→CTA mapping | `web/src/shared/errors.ts` `CTA_BY_CODE` + `ctaLabelForCode` | `network_error`, `timeout_error`, `no_firmware`, `port_in_use`, `connection_lost`, `not_found` |
| Retry button | `web/src/components/ui/error-box.tsx` (`onRetry` prop) | label derived from the code |
| Viewport retry | `web/src/features/viewport/viewport.tsx` | re-fires `GET /scene` |
| Catalog retry | `web/src/features/robots/components/robot-catalog.tsx` | `refetch()` of the robots query |
| Execution retry | `web/src/features/execution/execution-workspace.tsx` | Reintentar = reset+start; Reconectar = reconnect+reset+start |
| Preview CTA | `web/src/features/planning/components/planning-panel.tsx` | Recompilar = re-run preview |
| Backend lifecycle API | `POST /backends/{id}/{activate,connect,disconnect}` + `GET /backends` | codes 400 `no_firmware`/`port_in_use`/`not_connected`/`connection_lost`, 404 `not_found` |
| Backend selector | `web/src/features/execution/components/backend-selector.tsx` | Simulation/Hardware switch, port input, Conectar/Desconectar, CTAs |

## Demo triggers (no real ESP32 needed)

| Scenario | Trigger |
|----------|---------|
| 1 Backend apagado | stop the backend process, then load the scene / catalog / start execution |
| 2 Timeout | point the backend at a slow/hung port or use a proxy that never answers |
| 3 no_firmware | configure `THALOS_SERIAL_PORT` to an existing-but-silent device (e.g. a TTY with nothing answering HELLO) |
| 4 port_in_use | set `THALOS_SERIAL_PORT` to a port held by another process (`socat`, a second instance) |
| 5 not_found | request an unknown robot id from the catalog |
| 6 manifest invalid | compile a task referencing an undeclared object/location |
| 7 connection_lost | unplug the serial device mid-execution (firmware demo) |

## Verification

- Frontend: `pnpm test` (648 passing, includes the resilience-matrix suites).
- Backend: `cargo test --workspace` (1787 passing, includes backend-management suites).
- Manual: `docs/demo-smoke-test.md` — step 8 (browser-exercised scene creation)
  and the matrix triggers above.
