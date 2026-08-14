# Repair Alternatives

A constrained task: pick **box-1**, carry it toward **station-a** (a pose
hugging icebot's full-extension workspace limit), then place it on **tray-1**.
The carry is the risky part — and it comes from **program geometry** (the
`move_to station-a` instruction), never from a fixture.

## What it demonstrates

- The candidate pipeline: `generate → compile → analyze → assess → gate →
  rank` running on a real task (the interior carry is an eligible segment).
- **Risk detected in the Direct realization** — the constrained carry is
  assessed high-risk (icebot near full extension).
- An **admissible non-Direct realization is selected** — the pipeline repairs
  the Direct path instead of executing it blindly.

## Expected pipeline decision

`admissible = true` — the task executes, and `selected = non-Direct`
(repaired alternative).

> **Honest caveat (tuning evidence)**: on icebot the selected alternative is
> the *degenerate same-side re-solve* (`AlternateElbow` via position-only IK —
> icebot's `axis_1` limit blocks the mirrored elbow, so the candidate is a
> sub-epsilon copy of Direct carrying equal risk). The predicate `selected =
> non-Direct` holds, but a **strictly-better** repaired alternative does not
> exist on icebot with the current strategy library (`InsertWaypoint` cannot
> target the MoveJ the policy selects). Surfaced as a production-evaluator
> finding in apply-progress.md — this demo's story depends on the orchestrator
> decision (epsilon-tie evaluator fix would require a *genuine* alternative;
> today the noise favors the alternate).

## Observed evidence (reference — not asserted)

| Run | Execute | Segments | Direct risk | Admissible | Selected |
|-----|---------|----------|-------------|------------|----------|
| 1   | 200 ok  | 9        | 0.625       | ✅         | AlternateElbow (non-Direct) |

## How to run in the UI

1. Open the **Demos** workspace → **[Load Demo]** on *Repair Alternatives*.
2. Ensure icebot is loaded and started near the demo `home_pose`.
3. **[Run]** — the pipeline executes the task and the analysis replaces the
   risky Direct realization with the repaired alternative.
