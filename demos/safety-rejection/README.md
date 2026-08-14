# Safety Rejection

The box is placed **outside icebot's workspace envelope** (radius 0.26 m —
the arm's maximum reach is 0.225 m). No admissible realization exists, so the
pipeline **refuses to execute**.

## What it demonstrates

- The pipeline's safety boundary: an unreachable target is **detected, not
  silently passed**.
- The **BLOCKED UX**: the semantic executor refuses with `422 planning_error`
  (`IK failed ... MaxIterations`) — the task never runs, the robot never moves
  toward an impossible goal.
- Reproducibility of the failure: the same scene + program always blocks.

## Expected pipeline decision

`admissible = false` — execution is blocked; no plan is scheduled.

## Observed evidence (reference — not asserted)

| Run | Execute | Body |
|-----|---------|------|
| 1   | 422 `planning_error` | `IK failed for instruction 2: MaxIterations` (the pick's approach) — no plan scheduled |

## How to run in the UI

1. Open the **Demos** workspace → **[Load Demo]** on *Safety Rejection*.
2. Ensure icebot is loaded (the robot itself is fine — only the box is out of
   reach).
3. **[Run]** — the pipeline reports the planning error and nothing executes.
   This is the intended demonstration: Thalos refuses an impossible task.
