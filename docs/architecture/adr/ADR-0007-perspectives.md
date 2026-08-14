# ADR-0007: Perspectives

## Status

Proposed

## Context

Thalos started with a single layout: 3D scene + right panel (tools) + bottom panel (observability). As capabilities grew —Planning, Execution, Telemetry, Sessions, Comparison, Alternatives— every new feature was shoehorned into this fixed layout.

The bottom panel became a dumping ground with 6 unrelated tabs (Snapshot, Analysis, Sessions, Timeline, Plan Analysis, Log). The right panel grew from 4 tools to 8. Capabilities that need full-width space (charts, comparison, alternatives) compete for space in narrow sidebars.

The current `AppMode` (`robot | planning | execution`) only controls which tools appear in the right panel. It does not control:
- Whether the left panel (robot catalog) is visible
- Whether the bottom panel exists
- What content the bottom panel shows
- The overall layout configuration

## Decision

Replace the fixed three-panel layout with **perspectives** — workspace configurations that reorganize panels based on the user's current task.

### Definition

A perspective defines:
1. Which panels exist (left, right, bottom)
2. What content each panel shows (tools, tabs)
3. Panel dimensions and visibility

The 3D scene viewer remains constant across all perspectives — it is the visual context, not a competing panel.

### The four perspectives

**Planning** — Designing trajectories
- Left: Robot catalog (load/switch robots)
- Right: Motion planning, Trajectory color, Alternatives
- Bottom: Plan Analysis findings, Recommendations
- Iterative flow: plan → analyze → alternatives → apply

**Execution** — Running and observing
- Left: (hidden)
- Right: Active Plan controls, Telemetry charts
- Bottom: Timeline, Log
- Live flow: start → observe → adjust → stop

**Sessions** — Reviewing past executions
- Left: Session browser (list, filter, select)
- Right: Replay controls, Comparison metrics
- Bottom: (hidden — charts live in right panel)
- Review flow: browse → select → replay → compare

**Robot** — Loading and inspecting robots
- Left: Robot catalog
- Right: FK, IK, Workspace analysis, TCP
- Bottom: (hidden)
- Setup flow: load robot → explore kinematics → configure TCP

### Type model

```typescript
type Perspective = 'planning' | 'execution' | 'sessions' | 'robot';

interface PerspectiveConfig {
  showLeftPanel: boolean;
  showBottomPanel: boolean;
  rightPanel: ToolSchema[];
  bottomPanel?: TabSchema[];
  leftPanelContent?: 'robots' | 'sessions';
}
```

### Migration from AppMode

- `robot` → `robot` perspective (same behavior, no bottom panel)
- `planning` → `planning` perspective (includes alternatives + analysis in bottom)
- `execution` → `execution` perspective (telemetry moves from tool to right panel, timeline stays in bottom)
- New: `sessions` perspective (session browser + replay + comparison)

### What stays constant

- The 3D scene viewer (`scene-viewer`) — always present, always centered
- The status bar — always at the bottom, shows global state
- The top bar — holds perspective switcher (replaces current mode tabs)
- All stores (`SceneStore`, `SessionStore`, `ReplayStore`, etc.) — unchanged
- The `SessionApiService` and all backend APIs — unchanged

### What changes

1. `AppMode` → `Perspective` (broader type)
2. `ModeStore` → `PerspectiveStore` (same role, wider scope)
3. `UI_MODE_REGISTRY` → `PERSPECTIVE_REGISTRY` (now includes left + bottom panel config)
4. `app.html` — conditional panel rendering based on perspective config
5. `BottomPanel` — tabs become perspective-specific, not global
6. `TopBar` — 4 perspective tabs instead of 3 mode tabs

### What gets removed

- Bottom panel tabs that don't belong to the active perspective are not rendered
- No more "Sessions" tab in Planning perspective
- No more "Plan Analysis" tab in Execution perspective
- Each perspective owns its bottom panel content

## Rationale

### Why not extract telemetry to a separate app?

Telemetry's value appears when answering questions about *this* robot, *this* plan, *this* execution. Extracting it breaks the flow:
```
Select plan → Execute → Observe → Compare → Recommend
```
Perspectives keep this flow within a single application while giving each stage its own workspace.

### Why not just add more tabs to the bottom panel?

The bottom panel is already overloaded with 6 tabs. Adding comparison, deviation charts, and alternatives would push it to 9+. The bottom panel cannot be both a log viewer, a chart container, a session browser, and an analysis dashboard simultaneously.

### Why 4 perspectives and not 5 or 6?

The user's tasks map to 4 natural workflows:
1. Setting up a robot (Robot)
2. Designing a plan (Planning)
3. Running and observing (Execution)
4. Reviewing past executions (Sessions)

"Hardware" could be a 5th, but it can start as a tab within Execution and graduate to a perspective when the hardware configuration surface grows.

### Why not keep the left panel always visible?

In Execution, the user doesn't need to change robots mid-execution. Hiding the left panel gives the 3D scene and telemetry more horizontal space — which is what the execution task needs.

## Consequences

1. `app.html` becomes data-driven — panels render based on `PERSPECTIVE_REGISTRY[perspective]`
2. `BottomPanel` becomes a shell — its tabs are injected per perspective, not hardcoded
3. `LayoutStore` persists per-perspective dimensions (planning might have a wider right panel than robot)
4. The session browser moves from a bottom panel tab to the left panel of the Sessions perspective
5. Telemetry charts move from a right-panel tool (cramped) to a dedicated right-panel slot in Execution perspective
6. Migration is incremental — `AppMode.robot` maps directly to `Perspective.robot` with no behavioral change

## Alternatives Considered

### Multiple tabs at the top level (current approach)

Already outgrown. 6 bottom tabs, 8 right-panel tools. Does not scale.

### Separate routes (/planning, /execution, /sessions)

Would work, but breaks the continuous flow. The user would lose the 3D scene context when switching routes. Perspectives keep the 3D scene as a persistent anchor.

### Dashboard with draggable widgets (like Grafana)

Maximum flexibility, but maximum complexity. The user has to configure their own workspace. Perspectives provide a curated experience — each one is designed for a specific task, not assembled by the user.

### Split-screen (two 3D scenes for plan vs execution)

Visually powerful but not justified yet. Comparison can start as charts and metrics in the Sessions perspective. A split-screen 3D overlay could come later if visual comparison proves necessary.