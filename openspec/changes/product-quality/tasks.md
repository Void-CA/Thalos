# Tasks: product-quality (post-freeze demo quality)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~435–705 total (PR1 75–140 · PR3 30–50 · PR2 210–310 · PR4 120–205) |
| 400-line budget risk | Low per PR (total exceeds → chained mandatory) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR3 → PR2 → PR4 (stacked to main, merge order) |
| Delivery strategy | force-chained |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Task UI cleanup (items 1, 5, 6) | PR1 | `pnpm test` | `pnpm dev` → /task: no selector, no spinners, accordion cerrado | `git revert <pr1>` — selector/`defaultOpen`/`defaultValue` vuelven |
| 2 | Z-up render (item 3) | PR3 | `pnpm test` (scene-entities) | `pnpm dev` → orbit: tray plano, labels arriba | `git revert <pr3>` — tray edge-on vuelve |
| 3 | Planning→execute flow (items 2, 4) | PR2 | `pnpm test` (derive/registry/guards/execution-workspace) | `pnpm dev` → planificar preview → /execution activo con plan + tabs | `git revert <pr2>` — gate + tabs colapsan |
| 4 | Error/backend robustness (items 7, 8, 9) | PR4 | `pnpm test` + `cargo test --workspace` | preview falla → CTA en vez de texto crudo; badge Simulation | `git revert <pr4>` — texto crudo vuelve; `source` es aditivo |

Strict TDD RED-first, runners: frontend `pnpm test`, backend `cargo test --workspace`. Threat matrix: N/A (sin routing/shell/subprocess/VCS boundary).

## Phase 1: PR1 — task-ui-cleanup (items 1, 5, 6)

- [x] 1.1 RED reescribir `use-scene-robot-sync.test.tsx:210-221`: sin RobotSelector/`ROBOT_SELECTION_KEY`; GET /scene única vía load (loadScene 1x)
- [x] 1.2 RED reescribir `tools-registry.test.ts`: 4 tools, shape sin `defaultOpen`
- [x] 1.3 GREEN eliminar `robot-selector.tsx` + `robot-selector.test.tsx` + `ROBOT_SELECTION_KEY`; quitar mount en `semantic-workspace.tsx`
- [x] 1.4 GREEN `index.css`: `input[type="number"]` spinner hide global (appearance:none + `-webkit-inner-spin-button`)
- [x] 1.5 GREEN `tools-registry.ts:11,22-25` quitar `defaultOpen` de `ToolDef`+entradas; `robots/workspace.tsx:30-32` quitar `defaultValue`
- [x] 1.6 Verify `pnpm test` suite completa verde

## Phase 2: PR3 — scene-zup (item 3)

- [x] 2.1 RED extender `scene-entities.test.tsx`: rotation `[π/2,0,0]`, label offset Z, z-nudge `ENTITY_SIZE/2`, seeds intactos
- [x] 2.2 GREEN `scene-entities.tsx`: cylinder rotation, label `[0,0,LABEL_OFFSET]`, z-nudge en z=0
- [x] 2.3 Verify `pnpm test` + orbit check manual en demo-smoke-test

## Phase 3: PR2 — planning-exec-flow (items 2, 4)

- [x] 3.1 RED `derive.test.ts:139-159,284`: `executable` rebase sobre `planReady`; invariante `executable⇒planReady`
- [x] 3.2 RED `registry.test.ts:85,231`: `/execution` → `['sceneValid','planReady','executable']`
- [x] 3.3 RED `router.guards.test.tsx:182-198`: `planReady=false` → redirect `/task`
- [x] 3.4 RED `execution-workspace.test.tsx:73`: empty-state text update
- [x] 3.5 RED `use-workflow-state.test.ts`: selector `activePlanPresent` + planReady
- [x] 3.6 GREEN `types.ts` + `derive.ts:78`: `planReady = compiled \|\| activePlanPresent`; executable rebased; `FLAG_PHRASES`
- [x] 3.7 GREEN `use-workflow-state.ts`: selector `activePlanPresent` (activePlan !== null)
- [x] 3.8 GREEN `registry.ts:43`: nuevo gate `/execution`
- [x] 3.9 GREEN `planning-panel.tsx:47`: onSuccess → `executionStore.receivePlan({instructionCount, durationSecs, source:'Motion Program'})`
- [x] 3.10 GREEN `planning/workspace.tsx`: Tabs "Motion Program"/"Analysis" (badge `report!==null`); data-gate PlanCharts/AlternativesPanel
- [x] 3.11 Verify `pnpm test` suite completa verde

## Phase 4: PR4 — robustness-demo (items 7, 8, 9)

- [ ] 4.1 RED nuevo `shared/errors.test.ts`: describeError code→CTA, unknown-code fallback, non-ApiError fallback
- [ ] 4.2 RED `execution-workspace.test.tsx`: error `{message, code}` preservado; render code→CTA; badge Simulation/Hardware
- [ ] 4.3 RED `runtime-state-response.test.ts`: fixture con `execution.source` en wire
- [ ] 4.4 GREEN `shared/errors.ts`: lift `describeError` + `CTA_BY_CODE` + `reachCtaForPlanningError`
- [ ] 4.5 GREEN nuevo `components/ui/error-box.tsx`: ErrorBox compartido (`{message, code?} | Error | string`)
- [ ] 4.6 GREEN `execution-store.ts`: `error: {message,code}\|null`; preservar code en catch blocks :144,:188,:198,:208,:218,:228
- [ ] 4.7 GREEN `execution-workspace.tsx:112`: render vía describeError + badge source; `task-editor.tsx` drop local describeError
- [ ] 4.8 GREEN `analysis-metrics.tsx:108` + `ik-panel.tsx:299` quitar ErrorBox local; `analysis-workspace.tsx:9` + `alternatives-panel.tsx` → shared
- [ ] 4.9 GREEN backend `responses.rs:278` `ExecutionDto.source: Option<String>`; `mappers/delta.rs:25` + `mappers/runtime.rs:257` populate
- [ ] 4.10 Verify `cargo test --workspace` + `pnpm test` verdes
- [ ] 4.11 Docs `docs/demo-smoke-test.md`: firmware runbook (serial protocol, STOP recovery, rollover-safety, board-config caveat)

## Phase 5: E2E verification

- [ ] 5.1 Re-run `docs/demo-smoke-test.md` tras PR2 y PR4 → 17/17 PASS
