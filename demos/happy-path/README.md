# Happy Path

A single pick-and-place cycle: pick **box-1**, place it on **tray-1**, return
home. The simplest possible showcase — one object, one destination, no
constraints.

## What it demonstrates

- The full pipeline end-to-end: Scene → Semantic → Compile → Plan → Execute.
- A task whose Direct realization is **admissible**: the pipeline plans and
  executes it with no repair required.
- The visualization-only rule in practice: the box carries `geometry` for the
  viewport, which the pipeline ignores (fixtures/geometry never drive planning).

## Expected pipeline decision

`admissible = true` — the task executes and the analysis ranks the Direct
realization among the admissible candidates.

> **Note (tuning evidence)**: the design's stricter predicate `selected =
> Direct` is **not realizable on icebot today**. icebot's `axis_1` limit
> `[0, 2.0944]` forbids the mirrored elbow, so the `AlternateElbow` candidate
> is a *degenerate same-side re-solve* — a sub-epsilon copy of Direct that
> wins the evaluator's J tie-break on floating-point noise. This is a
> production-evaluator finding surfaced by the tuning slice (see
> `openspec/changes/showcase-scenarios/apply-progress.md`), pending an
> orchestrator decision. The test asserts the realizable core: **Direct is
> admissible (ranked)** and the pipeline executes.

## Observed evidence (reference — not asserted)

| Run | Execute | Segments | Direct risk | Direct admissible | Selected |
|-----|---------|----------|-------------|-------------------|----------|
| 1   | 200 ok  | 8        | 0.625       | ✅ ranked         | AlternateElbow (degenerate) |

## How to run in the UI

1. Open the **Demos** workspace and click **[Load Demo]** on *Happy Path*
   (loads `scene.json` + `program.thalos`; load ≠ run).
2. Make sure the runtime robot is **icebot** and the runtime is near the demo
   home (bent seed — see the scene's `home_pose`; never run from the
   full-extension zero configuration, which is singular).
3. Click **[Run]** — the existing pipeline executes and the viewport plays the
   pick → place → home motion.
