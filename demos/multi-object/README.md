# Multi-Object

Two boxes, two trays: pick **box-1** → place at **tray-1**, pick **box-2** →
place at **tray-2**, home. A composed sequence of several operations executed
in order.

## What it demonstrates

- **Composition**: multiple pick/place operations in a single program.
- The pipeline executing every operation in sequence — the whole task
  completes (nothing is skipped, nothing is dropped).
- Multiple objects and destinations at distinct, independently reachable
  poses inside icebot's workspace.

## Expected pipeline decision

`admissible = true` — every pick/place operation compiles and executes; the
analysis ranks an admissible realization (all operations complete).

## Observed evidence (reference — not asserted)

| Run | Execute | Segments | Direct risk | Direct admissible | Selected |
|-----|---------|----------|-------------|-------------------|----------|
| 1   | 200 ok  | 14       | 0.625       | ✅ ranked         | AlternateElbow (degenerate) |

(Same degenerate-alternate note as `happy-path` — see apply-progress.md.)

## How to run in the UI

1. Open the **Demos** workspace → **[Load Demo]** on *Multi-Object*.
2. Ensure the runtime is icebot, started near the demo `home_pose`.
3. **[Run]** — the pipeline executes both pick/place pairs in sequence.
