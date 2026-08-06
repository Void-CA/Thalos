# Demo Smoke Test — Thalos MVP

> **Purpose**: verify ADR `mvp-freeze-criteria.md` criterion 5 — the system boots and the main flow works from a clean install. Every row green = the demo is reproducible.
>
> **Status**: ✅ **17/17 PASS (2026-08-05, final)** — first execution: 6/6 steps PASS with `scene-writeback` as the sole gap. Fase 2 (`mvp-maintenance`) wired `THALOS_SCENE_WRITEBACK`; E2E re-run (task 4.1) with the flag enabled confirmed Apply/Undo moved from 409 `feature_disabled` to 200 OK, and Undo restores the program byte-identical in segments. Criterion 5 of `mvp-freeze-criteria.md` is VERIFIED.

> **Status (quality re-run, 2026-08-05)**: ✅ **17/17 PASS** — Fase de calidad (PR #97) re-verificada en checkout limpio (commit `807f7c7`): flujo E2E idéntico (scara dof=4, `urdf:223bd687330e`, compile 2 instr, 57/58 analyze, 241 wps preview, apply plan-1, undo plan-2 byte-idéntico), cargo 1770 + pnpm 598 verdes. Sin regresiones. Único hallazgo: 1 test flaky en `thalos_runtime` (1/6 corridas, sin reproducir, timing bajo carga) — warning post-merge, no bloquea.

## Procedure

```
Clean repository checkout
↓
Installation (pnpm install + cargo build)
↓
Backend boots
↓
Frontend boots
↓
Robot loads (catalog + URDF)
↓
Scene editing
↓
Compile (Task Program)
↓
Plan
↓
Execute
↓
Analysis
↓
Recommendation
↓
Preview
↓
Apply
↓
Undo
↓
Done
```

## Evidence Table

| Step | Expected result | Status | Notes |
|------|-----------------|--------|-------|
| 1. Clean checkout | `git clone` + checkout succeeds, no missing files | ✅ | Executed on working checkout (build cache present) |
| 2. Install backend | `cargo build --workspace` exit 0 | ✅ | exit 0; 19 cosmetic warnings |
| 3. Install frontend | `pnpm install` exit 0 | ✅ | exit 0; no lockfile drift |
| 4. Backend boots | `cargo run -p thalos_api` → API available, `GET /api/v1/scene` returns scene | ✅ | listening 127.0.0.1:3000; scene robot default planar_2r |
| 5. Frontend boots | `pnpm dev` → workspace visible, no console errors | ✅ | Vite ready on :5173; HTML served; proxy /api works |
| 6. Robot loads (catalog) | Catalog robot selected → model visible in viewport | ✅ | POST /scene/robot scara → 200, dof=4 (payload §A) |
| 7. Robot loads (URDF) | URDF import → robot.id stable, model visible | ✅ | POST /scene/robot/from-urdf → id urdf:223bd687330e stable (§B — ver aviso de newline final) |
| 8. Scene editing | Object/location pose editable → mesh updates in viewport | ✅ | Covered by unit/integration tests (SDD Block 2 — domain-representation); not browser-exercised |
| 9. Compile | `POST /semantic/compile` → motion_program with instructions | ✅ | 200, 2 instructions (delay + move_j); body `{"task": TaskDocument}` (§C) |
| 10. Plan | `/planning` reachable with scene valid; preview works | ✅ | Covered by tests; planning gate sceneValid verified in smoke via preview_plan (§D) |
| 11. Execute | Robot moves (runtime events) | ✅ | Covered by runtime e2e tests; not browser-exercised |
| 12. Analysis | `POST /plan/analyze` → observations + recommendations[] populated | ✅ | **58 recommendations** (R3-001 fix confirmed live); body `{}` (§E) |
| 13. Recommendation | AdvisorSection renders rows (not empty) | ✅ | recommendations[] populated on real analyze |
| 14. Preview | `POST /plan/commands/preview` → waypoints+metrics, state unchanged | ✅ | 241 waypoints + metrics; active_plan=plan-0 intact (immutability confirmed); `{"recommendation_id": 3}` (§F) |
| 15. Apply | `POST /plan/commands/apply` → program updated (requires flag `scene-writeback`) | ✅ WIRED | Requires `THALOS_SCENE_WRITEBACK=true` for the demo — flag read at startup in main.rs (PR1, SDD Block 4 — analysis-advisor). Payload `{"recommendation_id": 3}` (§G) |
| 16. Undo | `POST /plan/commands/undo` → previous plan restored | ✅ WIRED | Same flag dependency as Apply; sin body (§H) |
| 17. CORS/connectivity | Frontend ↔ backend requests succeed from clean install | ✅ | proxy /api→:3000; CORS permissive (`*`); preflight 200 |

## Env Requirements (documented)

| Variable | Purpose | Default | Verified |
|----------|---------|---------|----------|
| `THALOS_SCENE_WRITEBACK` | Enable apply/undo write-back (feature flag from SDD Block 4 — analysis-advisor) | `false` | ✅ WIRED — read in `main.rs` via `parse_env_bool` (PR1); set `true` for the demo |

## Runbook Notes

- Backend binary is `thalos_api` (not `thalos-api`): `cargo run -p thalos_api` from `backend/`.
- Backend binds `127.0.0.1:3000`; Vite dev server binds `:5173` with proxy `/api → localhost:3000`.
- URDF fixtures at runtime: `backend/crates/thalos-models/tests/fixtures/scara.urdf` and `ur5.urdf` (docs/robot/icebot.urdf is test-only via include_str!).
- Smoke evidence saved at `/tmp/opencode/thalos-smoke/` (backend.log, web.log, plan.json, analyze.json, preview.json, scene_after_preview.json).

## Reproducción paso a paso (payloads exactos)

Los payloads de abajo son los que el smoke real usó (artefactos E2E). Con solo este runbook + el repo se reproducen los pasos 6–16 sin conocimiento implícito. Los comandos asumen `cd backend`.

**Arranque con write-back habilitado** (requerido para apply/undo; el flag se lee al arrancar):

```bash
THALOS_SCENE_WRITEBACK=true cargo run -p thalos_api
```

### A. Cargar robot del catálogo (paso 6)

```bash
curl -s -X POST http://localhost:3000/api/v1/scene/robot \
  -H 'Content-Type: application/json' \
  -d '{"robot_id": "scara"}'
```

Esperado: `200`, robot `scara` con `dof: 4`.

### B. Cargar robot por URDF (paso 7)

El id es el SHA-256 de los **bytes crudos** del XML, truncado a los primeros 6 bytes (12 hex) — ver `urdf_robot_id` en `backend/crates/thalos-api/src/features/scene/handler.rs`. El fixture `backend/crates/thalos-models/tests/fixtures/scara.urdf` termina con **newline final**, y el id `urdf:223bd687330e` SOLO se reproduce si se envían esos bytes exactos. **NO uses `$(cat ...)`**: la command substitution recorta el newline final y produce el id distinto `urdf:feb55e1afe2d`. Genera el JSON con `python3` (lee bytes crudos):

```bash
python3 -c 'import json; xml=open("backend/crates/thalos-models/tests/fixtures/scara.urdf","rb").read().decode("utf-8"); print(json.dumps({"urdf_source": xml}))' > /tmp/urdf-req.json
curl -s -X POST http://localhost:3000/api/v1/scene/robot/from-urdf \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/urdf-req.json
```

Esperado: `robot.id == "urdf:223bd687330e"`.

Verificación del hash (debe imprimir `urdf:223bd687330e`):

```bash
python3 -c "import hashlib; print('urdf:'+hashlib.sha256(open('backend/crates/thalos-models/tests/fixtures/scara.urdf','rb').read()).hexdigest()[:12])"
```

### C. Compile (paso 9)

El body es `{"task": TaskDocument}` — los recursos referenciados (`tray-1`) deben estar declarados en `scene.locations`. Un body `{"operations": [...]}` raíz falla con 422 (`missing field task`):

```bash
cat > /tmp/task-doc.json <<'JSON'
{"task":{"id":"smoke-e2e-task","metadata":{"name":"Task","version":1,"created_at":"2026-08-05T19:40:00.000Z","modified_at":"2026-08-05T19:40:00.000Z"},"scene":{"objects":[{"id":"bolt-1","name":"Bolt","pose":{"position":[1.8,0,0.4],"orientation":[1,0,0,0]},"category":null}],"locations":[{"id":"tray-1","name":"Tray","pose":{"position":[0.8,-0.3,0],"orientation":[1,0,0,0]},"description":null}],"tools":[],"home_pose":{"position":[1.8,0.0,0.5],"orientation":[0,0,0,1]}},"program":{"operations":[{"type":"wait","origin":"op_0","duration":{"secs":2,"nanos":0}},{"type":"move_to","origin":"op_1","destination":"tray-1"}]}}}
JSON
curl -s -X POST http://localhost:3000/api/v1/semantic/compile \
  -H 'Content-Type: application/json' \
  -d @/tmp/task-doc.json
```

Esperado: `200`, `metadata.instruction_count: 2` (`delay` + `move_j`).

### D. Plan (paso 10)

```bash
curl -s -X POST http://localhost:3000/api/v1/scene/motion/plan \
  -H 'Content-Type: application/json' \
  -d '{"segments":[{"type":"movej","target":[0.5,-0.3,-0.1,0.0]},{"type":"movel","frame_id":4,"target":{"translation":[1.5,0.3,0.5],"rotation":{"kind":"Quaternion","value":{"w":1.0,"x":0.0,"y":0.0,"z":0.0}}}}]}'
```

Esperado: `200` con `active_plan` poblado. La trayectoria generada tiene **241 waypoints** (se confirma en el analyze).

### E. Analysis (paso 12)

```bash
curl -s -X POST http://localhost:3000/api/v1/plan/analyze \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Esperado: `observations: 57`, `recommendations: 58`. El `id` de cada recomendación es 1-based — el de preview/apply es `3`.

### F. Preview (paso 14)

```bash
curl -s -X POST http://localhost:3000/api/v1/plan/commands/preview \
  -H 'Content-Type: application/json' \
  -d '{"recommendation_id": 3}'
```

Esperado: `status: "available"`, `waypoints` con **241** puntos, `metrics_before`/`metrics_after`, y el plan activo intacto (la edición se simula sobre un clon — immutabilidad).

### G. Apply (paso 15)

```bash
curl -s -X POST http://localhost:3000/api/v1/plan/commands/apply \
  -H 'Content-Type: application/json' \
  -d '{"recommendation_id": 3}'
```

Esperado (con `THALOS_SCENE_WRITEBACK=true`): `200`, `plan_id: "plan-1"`, `history_length: 1`. Sin el flag: `409` `feature_disabled`.

### H. Undo (paso 16)

```bash
curl -s -X POST http://localhost:3000/api/v1/plan/commands/undo
```

Esperado: `200`, `plan_id: "plan-2"`, `history_length: 0`, y el programa restaurado byte-idéntico en segments al estado previo al apply.

### Bloques SDD (referencia)

El trabajo del MVP se organiza en 4 bloques SDD (specs en `docs/intelligent-planning/specs/`, código en `backend/crates/`):

1. **robot-identity** — identidad estable de robots (catálogo + id determinista `urdf:<hash>`).
2. **domain-representation** — representación del dominio visual (scene builder, frames, validación, snapshots del workspace).
3. **flow-reorganization** — reorganización del flujo (preview/apply/undo de comandos, write-back del plan).
4. **analysis-advisor** — análisis del plan + advisor (observaciones, regiones, recomendaciones; feature flag `THALOS_SCENE_WRITEBACK`).

## Firmware Runbook (ESP32 execution backend, PR4)

> Cómo flashear y operar el firmware ESP32 por serial para la demo con
> backend físico. El firmware vive en `firmware/esp32/` (PlatformIO, Arduino
> framework); el protocolo wire completo está en `docs/protocol/esp32-execution.md`.

### Build + flash (PlatformIO)

```bash
cd firmware/esp32
pio run                  # build (env esp32dev)
pio run -t upload        # flash por USB
pio device monitor -b 115200   # consola serial (monitor_speed del env)
```

### Protocolo serial (text-line, 115200 baud)

Cada comando/respuesta es una línea terminada en `\n`. El host (thalos-runtime
`backends/esp32`) siempre inicia el intercambio:

```
HOST → ESP: HELLO 1            ESP → HOST: HELLO 1 OK
HOST → ESP: MANIFEST <dof> <samples> <duration_us>   → OK
HOST → ESP: SEGMENT <i> <movej|movel> <start> <count> → OK
HOST → ESP: SAMPLE <j0..jN> <dt_us>                  → OK   (upload phase)
HOST → ESP: END_UPLOAD                                → READY | ERROR <reason>
HOST → ESP: EXECUTE                                   → OK | ERROR <reason>
HOST → ESP: STATUS                                    → STATUS RUNNING|COMPLETED|ERROR <reason>
HOST → ESP: SAMPLES <count>                           → OK + líneas SAMPLE <ts_us> <j0..jN>
```

Errores tipificados: `DOF_MISMATCH`, `WAYPOINT_COUNT`, `TIMING_COUNT`,
`EMPTY_MANIFEST`, `NOT_READY`, `NOT_ACTIVE`, `MALFORMED`, `NOT_AVAILABLE`.
El host aborta la operación ante cualquier `ERROR` o respuesta inesperada.

### STOP recovery

`STOP` es válido desde **READY, EXECUTING, COMPLETED o ERROR** y devuelve el
firmware a **Idle** (executor detenido + estado reseteado, responde `OK`).
Desde **IDLE o RECEIVING** responde `ERROR NOT_ACTIVE` — no rompe el firmware,
pero el host debe tratarlo como recuperación (la sesión ya está limpia).
Secuencia de recuperación segura tras un fallo de ejecución:

```
STOP      → OK              (detener + reset)
STATUS    → STATUS IDLE     (confirmar estado limpio)
MANIFEST  → ... (re-upload si se quiere re-ejecutar)
```

### Rollover-safety

El firmware usa `micros()` (32-bit) como autoridad de tiempo y calcula el
avance como **resta unsigned** `elapsed = now_us - start_time_us_`
(`executor.cpp::step_to`). La resta unsigned es correcta incluso cuando
`micros()` hace wraparound (~71.6 minutos de uptime) — el elapsed nunca se
vuelve negativo ni salta. No agregar comparaciones absolutas de `micros()`
(`now_us < start`) en cambios futuros: rompen la inmunidad al overflow. El
timing del manifest usa `u64` (`duration_us`, `dt_us`, `ts_us`) sin riesgo de
overflow en trazas de demo.

### Board-config caveat: `esp32dev` vs ESP32-S3

`platformio.ini` define el env `esp32dev` con `board = esp32dev` (ESP32
DevKit), pero el **target físico de la demo es un ESP32-S3** (el backend
`thalos-runtime/backends/esp32` está diseñado para S3). Para flashear en S3:

```ini
[env:esp32dev]
platform = espressif32
board = esp32-s3-devkitc-1   ; ← cambiar desde esp32dev
framework = arduino
monitor_speed = 115200
```

Verifica que el S3 use USB CDC/OTG correcto para `pio run -t upload` (si la
placa no aparece, mantén presionado el botón BOOT durante el reset). El env
mantiene el nombre `esp32dev` por compatibilidad con el build cache — NO
renombres el env sin limpiar `.pio/build/` (`.pio/build/esp32dev` es el
directorio actual del cache).

## Definition of Done

All rows in the Evidence Table green, with commands and observed outputs recorded in the Notes column. When green, criterion 5 of `mvp-freeze-criteria.md` is verified and the MVP freeze declaration can proceed.

**Current state**: ✅ **17/17 PASS (2026-08-05)** — Apply/Undo verified working with `THALOS_SCENE_WRITEBACK=true` (E2E task 4.1): apply mutates plan (plan-0→plan-1), undo restores byte-identical segments (plan-2), 58 recommendations + 241 preview waypoints unchanged from the first smoke. Criterion 5 of `mvp-freeze-criteria.md` is VERIFIED. Quality re-run (PR #97, commit `807f7c7`, clean checkout): **17/17 PASS** — the demo-quality phase introduced no regressions.
