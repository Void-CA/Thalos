# Repair Alternatives

A constrained task: pick **box-1**, carry it toward **station-a** (a pose
hugging icebot's full-extension workspace limit), then place it on **tray-1**.
The carry is the risky part — and it comes from **program geometry** (the
`move_to station-a` instruction), never from a fixture.

## What it demonstrates

- The candidate pipeline: `generate → compile → analyze → assess → gate →
  rank` running on a real task (the interior carry is an eligible segment).
- **Alternatives are surfaced**: the pipeline generates and scores more than
  one realization of the task — the strategy trace shows `AlternateElbow
  Generated` (the pipeline attempted repair).
- **Honest selection**: on icebot the alternate is a *sub-ε copy* of Direct,
  so no realization is measurably better — Direct wins the deterministic
  tie-break and the demo's story is "alternatives surfaced", not "better path
  chosen".

## Expected pipeline decision

`admissible = true` — the task executes, the ranking carries **≥2 admissible
candidates** (Direct admissible, AlternateElbow admissible), the strategy
trace shows **AlternateElbow Generated**, and **Direct** is selected.

> **Risk floor (2026-08-15)**: risk is structurally pinned at 0.625 on icebot —
> the manipulability floor fires `R07_low_manipulability` at activation
> ≈ 0.96–0.97 and the Mamdani centroid lands at ~0.625. No trajectory on icebot
> can leave the `low` manipulability zone.
>
> **No realization is measurably better (ε = 1e-4)**: `AlternateElbow` is a
> degenerate same-side re-solve (icebot's `axis_1` limit `[0, 2.0944]` blocks
> the mirrored elbow). Its metrics differ from Direct by sub-ε noise (duration
> delta 9.5e-6 s < 1e-4), so the deadband ties both candidates at J = 0.5 and
> the tie-break selects Direct. The pipeline DID generate and score the
> alternative — the demo shows repair being *attempted* and the evidence being
> *surfaced honestly*, not a fabricated better path.

## Observed evidence (reference — not asserted)

| Run | Execute | Segments | Direct risk | Ranking (strategy — cost J) | Selected |
|-----|---------|----------|-------------|-----------------------------|----------|
| 1   | 200 ok  | 9        | 0.625       | Direct 0.5 · AlternateElbow 0.5 (tied, sub-ε) | Direct (tie-break) |

Detail: `Direct` `[risk 0.625, duration 29.801319 s, manip 0.010822]` vs
`AlternateElbow` `[risk 0.625, duration 29.801309 s, manip 0.010822]` — both
admissible, both normalize to J = 0.5; the strategy trace shows
`AlternateElbow → Generated`.

## How to run in the UI

1. Open the **Demos** workspace → **[Load Demo]** on *Repair Alternatives*.
2. Ensure icebot is loaded — [Load Demo] homes the runtime automatically
   (closed-form bent start from the scene's `home_pose`).
3. **[Run]** — the pipeline executes the task and the analysis ranks the
   alternatives (Direct + AlternateElbow, both admissible).
