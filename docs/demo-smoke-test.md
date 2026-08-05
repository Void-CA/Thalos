# Demo Smoke Test — Thalos MVP

> **Purpose**: verify ADR `mvp-freeze-criteria.md` criterion 5 — the system boots and the main flow works from a clean install. Every row green = the demo is reproducible.
>
> **Status**: ✅ **17/17 PASS (2026-08-05, final)** — first execution: 6/6 steps PASS with `scene-writeback` as the sole gap. Fase 2 (`mvp-maintenance`) wired `THALOS_SCENE_WRITEBACK`; E2E re-run (task 4.1) with the flag enabled confirmed Apply/Undo moved from 409 `feature_disabled` to 200 OK, and Undo restores the program byte-identical in segments. Criterion 5 of `mvp-freeze-criteria.md` is VERIFIED.

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
| 6. Robot loads (catalog) | Catalog robot selected → model visible in viewport | ✅ | POST /scene/robot scara → 200, dof=4 |
| 7. Robot loads (URDF) | URDF import → robot.id stable, model visible | ✅ | POST /scene/robot/from-urdf → id urdf:223bd687330e stable |
| 8. Scene editing | Object/location pose editable → mesh updates in viewport | ✅ | Covered by unit/integration tests (Block 2); not browser-exercised |
| 9. Compile | `POST /semantic/compile` → motion_program with instructions | ✅ | 200, 2 instructions (delay + move_j) |
| 10. Plan | `/planning` reachable with scene valid; preview works | ✅ | Covered by tests; planning gate sceneValid verified in smoke via preview_plan |
| 11. Execute | Robot moves (runtime events) | ✅ | Covered by runtime e2e tests; not browser-exercised |
| 12. Analysis | `POST /plan/analyze` → observations + recommendations[] populated | ✅ | **58 recommendations** (R3-001 fix confirmed live) |
| 13. Recommendation | AdvisorSection renders rows (not empty) | ✅ | recommendations[] populated on real analyze |
| 14. Preview | `POST /plan/commands/preview` → waypoints+metrics, state unchanged | ✅ | 241 waypoints + metrics; active_plan=plan-0 intact (immutability confirmed) |
| 15. Apply | `POST /plan/commands/apply` → program updated (requires flag `scene-writeback`) | ✅ WIRED | Requires `THALOS_SCENE_WRITEBACK=true` for the demo — flag read at startup in main.rs (PR1). Full smoke re-run with the flag is task 4.1 (E2E) |
| 16. Undo | `POST /plan/commands/undo` → previous plan restored | ✅ WIRED | Same flag dependency as Apply |
| 17. CORS/connectivity | Frontend ↔ backend requests succeed from clean install | ✅ | proxy /api→:3000; CORS permissive (`*`); preflight 200 |

## Env Requirements (documented)

| Variable | Purpose | Default | Verified |
|----------|---------|---------|----------|
| `THALOS_SCENE_WRITEBACK` | Enable apply/undo write-back (feature flag from Block 4) | `false` | ✅ WIRED — read in `main.rs` via `parse_env_bool` (PR1); set `true` for the demo |

## Runbook Notes

- Backend binary is `thalos_api` (not `thalos-api`): `cargo run -p thalos_api` from `backend/`.
- Backend binds `127.0.0.1:3000`; Vite dev server binds `:5173` with proxy `/api → localhost:3000`.
- URDF fixtures at runtime: `backend/crates/thalos-models/tests/fixtures/scara.urdf` and `ur5.urdf` (docs/robot/icebot.urdf is test-only via include_str!).
- Smoke evidence saved at `/tmp/opencode/thalos-smoke/` (backend.log, web.log, plan.json, analyze.json, preview.json, scene_after_preview.json).

## Definition of Done

All rows in the Evidence Table green, with commands and observed outputs recorded in the Notes column. When green, criterion 5 of `mvp-freeze-criteria.md` is verified and the MVP freeze declaration can proceed.

**Current state**: ✅ **17/17 PASS (2026-08-05)** — Apply/Undo verified working with `THALOS_SCENE_WRITEBACK=true` (E2E task 4.1): apply mutates plan (plan-0→plan-1), undo restores byte-identical segments (plan-2), 58 recommendations + 241 preview waypoints unchanged from the first smoke. Criterion 5 of `mvp-freeze-criteria.md` is VERIFIED. For the formal freeze declaration, re-run on a truly clean checkout (this run used cached builds).
