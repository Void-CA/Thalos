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

`admissible = true` — the task executes, **`selected = Direct`** (deterministic
tie-break), and the analysis ranks every candidate.

> **Risk floor (2026-08-15)**: risk is structurally pinned at 0.625 on icebot —
> the manipulability floor fires `R07_low_manipulability` at activation
> ≈ 0.96–0.97 and the Mamdani centroid lands at ~0.625. No trajectory on icebot
> can leave the `low` manipulability zone.
>
> **Direct wins the deadband tie (ε = 1e-4)**: the `AlternateElbow` candidate is
> a *degenerate same-side re-solve* — icebot's `axis_1` limit `[0, 2.0944]`
> forbids the mirrored elbow, so it is a sub-ε copy of Direct (duration delta
> 1.38e-5 s < 1e-4). The epsilon deadband ties both candidates at J = 0.5 on
> every component, and the deterministic tie-break selects **Direct**, the
> first candidate in the original order. Selection is stable run-to-run.

## Observed evidence (reference — not asserted)

| Run | Execute | Segments | Direct risk | Ranking (strategy — cost J) | Selected |
|-----|---------|----------|-------------|-----------------------------|----------|
| 1   | 200 ok  | 8        | 0.625       | Direct 0.5 · AlternateElbow 0.5 (tied, sub-ε) | Direct (tie-break) |

Detail: `Direct` `[risk 0.625, duration 18.893269 s, manip 0.010232]` vs
`AlternateElbow` `[risk 0.625, duration 18.893255 s, manip 0.010231]` — both
normalize to J = 0.5; the sub-ε duration delta (1.38e-5 s) is below the
deadband and contributes nothing to the gap.

## How to run in the UI

1. Open the **Demos** workspace and click **[Load Demo]** on *Happy Path*
   (loads `scene.json` + `program.thalos`; load ≠ run).
2. Make sure the runtime robot is **icebot**. [Load Demo] homes the runtime
   automatically (closed-form bent start from the scene's `home_pose`) — never
   run from the full-extension zero configuration, which is singular.
3. Click **[Run]** — the existing pipeline executes and the viewport plays the
   pick → place → home motion.
