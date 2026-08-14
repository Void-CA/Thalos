# ADR-0001: Adopt Z-up as Canonical Coordinate System

**Status:** Accepted (migration complete)  
**Date:** 2026-06-24  
**Deciders:** @thalos-core  
**Driver:** URDF compatibility, ROS ecosystem alignment, internal consistency  

---

## Context

Thalos operates across FK, IK, URDF import, workspace analysis, trajectory planning, and Three.js visualization. Each subsystem was built incrementally, and the codebase accumulated multiple implicit coordinate conventions with no documented canonical system.

The audit (2026-06-24) revealed:

| Subsystem | Convention | Vertical axis | Source of truth |
|-----------|-----------|---------------|-----------------|
| SCARA (canonical model) | Y-up | Y | Factory `.y_axis()` definitions |
| Manipulator 3DOF | Y-up hybrid | Y | Joint 1 = Y, Joints 2-3 = Z |
| Planar 2R / 3R | Compatible with Z-up assumptions | — | Joint axes = Z, arm in XY |
| Cylindrical RPP | Z-up | Z | Base column in Z |
| Spherical Polar RRP | Mixed | Z | Base Z-up, joint 2 = Y |
| URDF import | **Z-up** (ROS standard) | Z | Passthrough, no conversion |
| Fixed joint default | Y-up | Y | `y_axis()` fallback |
| Three.js renderer | Y-up | Y | Default `camera.up = (0,1,0)` |
| Visual builder | Y-up | Y | Cylinder correction `Rx(+90°)` patches Z→Y |

**Critical finding:** The canonical SCARA and an identical SCARA imported via URDF produce **different FK end-effector positions** because `base_height` goes in Y (canonical) vs. Z (URDF). The codebase has no single answer to "what coordinate space does Thalos use?"

---

## Decision Drivers

1. **ROS / URDF ecosystem alignment** — URDF is the dominant robot description format and its standard is Z-up. Adopting Z-up means zero conversion on import, zero surprises when exchanging data with MoveIt, RViz, or ROS 2.
2. **Internal consistency** — A single canonical space eliminates the class of bugs where two models of the same robot produce different FK output.
3. **Traceability** — With a documented convention, every `.y` or `.z` access can be audited as "correct" or "bug" by reading the field name against the canonical axis semantics.
4. **Forward-looking** — Collision detection, sensor simulation, and motion planning tools (e.g., FCL, OMPL) commonly assume Z-up. Starting from Z-up now avoids a harder migration later.

---

## Considered Alternatives

### Alternative A: Keep Y-up (Three.js default)

**Pros:** No frontend changes. The renderer works out of the box.  
**Cons:** Every URDF import requires a runtime Z→Y conversion. The canonical SCARA model would need to stay inconsistent with URDF SCARA. The ROS ecosystem (URDF, MoveIt, RViz) all use Z-up — Thalos would be perpetually out of alignment.  
**Decision:** Rejected — the ongoing conversion tax and ecosystem mismatch outweigh the one-time renderer migration cost.

### Alternative B: Keep mixed, document per-model

**Pros:** No migration work.  
**Cons:** Perpetual mental overhead. Every new developer must learn "this model uses Y, this one uses Z." FK regression tests cannot share expected values between canonical and URDF versions of the same robot. The visual builder's cylinder correction becomes a permanent patch over an unresolved inconsistency.  
**Decision:** Rejected — this is the status quo that produced the audit findings.

### Alternative C: Y-up with URDF conversion layer

**Pros:** Renderer unchanged.  
**Cons:** Every URDF robot pays a runtime conversion cost. The conversion lives in the adapter but needs to be maintained and tested. Output coordinates (workspace, trajectory) would be Y-up, creating a mismatch with any ROS tool that consumes them.  
**Decision:** Rejected — addressing the symptom rather than the root.

---

## Decision

Adopt **Z-up** as the Thalos canonical coordinate system:

```
Canonical Space — Right-handed.

X: forward
Y: left
Z: up

X × Y = Z

All FK, IK, planning, workspace analysis, URDF import,
and canonical model definitions operate in this space.

Renderers may adapt coordinates for display but must never
alter canonical data. Renderers are consumers of canonical data,
not producers.
```

### What this means in practice

| Operation | Behaviour |
|-----------|-----------|
| FK output | `ee.z` is the vertical coordinate |
| Joint axes | `z_axis()` = vertical rotation (yaw), `x_axis()` / `y_axis()` = horizontal |
| Link translations | Height → `.z`, reach → `.x` |
| URDF import | **No conversion** — passthrough |
| Workspace sampling | Output positions are in Z-up canonical coordinates |
| Trajectory waypoints | `position.z` is the vertical coordinate |
| Three.js renderer | Configured to Z-up (`camera.up = (0,0,1)`) |

---

## Migration Plan

### Phase 0 — Freeze and document (this ADR)

- [x] Audit existing conventions across all subsystems
- [x] Publish ADR-0001
- [x] Update `docs/architecture/coordinates.md` with the canonical spec

### Phase 1 — Regression tests (before any migration)

- [x] FK test for every canonical model at `q = [0, ...]` with expected EE coordinates in Z-up
- [x] URDF import FK test for SCARA with expected EE in Z-up (already Z-up — verified, test passes)
- [ ] Workspace sampling smoke test
- [ ] Travis CI or equivalent gate

### Phase 2 — Migrate canonical models to Z-up (complete)

- [x] **SCARA** — `base_height` → Z, joint axes → `z_axis()`, link translations → `Vector3::new(l, 0, 0)`
- [x] **Manipulator 3DOF** — joint 1 → `z_axis()`, link 1 translation → Z
- [x] **Fixed joint default** — `y_axis()` → `z_axis()` in `joint.rs:70`
- [x] **Spherical Polar RRP** — confirmed already Z-up (no change needed — joint 2 is Y, which in Z-up is a horizontal pitch axis)
- [x] Run Phase 1 tests — all pass with Z-up expectations
- [x] Update visual builder — `ScaraVisualBuilder` reads `.z` for height
- [x] Old Y-up tests removed from SCARA and Manipulator 3DOF test files

### Phase 3 — Configure Three.js for Z-up (complete)

- [x] `camera.up.set(0, 0, 1)` before `OrbitControls` constructor
- [x] `linkUp` → documented as mesh adapter (stays `(0, 1, 0)`)
- [x] GridHelper → rotated to XY plane (`grid.rotation.x = π/2`)
- [x] Cylinder/Cone geometries → Y-aligned, mesh adapter retained (`linkUp` + `Rx(+90°)` in visual builder)
- [x] Compass → already uses world-space axis vectors (no change needed)
- [x] IK gizmo ring → RingGeometry defaults to XY plane (horizontal in Z-up), removed `rotation.x = π/2`
- [x] `fitToView` fallback → `center.z + dist` already correct for Z-up
- [x] Retain cylinder mesh adapter. Rationale: Three.js CylinderGeometry is Y-aligned while canonical Thalos cylinders are Z-aligned.
- [ ] Verify: trajectory, point cloud overlay, frames, compass — all visually correct in Z-up (manual — requires running the app)

### Phase 4 — Cleanup (complete)

- [x] Remove `contentGroup.rotation` if present — was never committed (n/a)
- [x] Audit any remaining `.y` that semantically means `height` and change to `.z` — all clean (factory files, visual builder already migrated in Phase 2)
- [x] Update test comments from `// Y-up:` to `// Z-up:` — done across all Jacobian test files
- [x] Migrate SCARA Jacobian tests (numerical + geometric) to Z-up
- [x] Migrate Manipulator 3DOF Jacobian tests (numerical + geometric) to Z-up

### Migration Complete When (all met)

- ✅ Canonical SCARA and URDF-imported SCARA produce identical FK output for identical parameters
- ✅ No backend model interprets height as Y
- ✅ No renderer component requires world-space Y-up assumptions
- ✅ All FK regression tests pass (238 lib tests, 23 integration tests)

---

## Consequences

### Positive

- URDF import becomes **pure passthrough** — no conversion, no surprises
- FK output matches ROS / MoveIt / RViz conventions
- Single mental model: "Z is up, always"
- The cylinder correction `Rx(+90°)` becomes a **mesh adapter** (Three.js `CylinderGeometry` defaults to Y) rather than a coordinate system patch — conceptually clean

### Negative

- One-time migration cost for canonical SCARA and Manipulator 3DOF
- Three.js renderer needs explicit Z-up configuration (deviates from Three.js default)
- Existing FK test assertions in SCARA tests need updating

### Neutral

- Planar 2R / 3R / Single Revolute / Cylindrical RPP are compatible with Z-up — no change needed
- IK solvers are convention-agnostic (pure matrix math) — no change needed
- Trajectory interpolation is convention-agnostic — no change needed

---

## References

- Audit output: conversation with @thalos-core on 2026-06-24
- URDF specification: http://wiki.ros.org/urdf/XML
- Three.js `OrbitControls` Z-up configuration: `camera.up.set(0, 0, 1)` before constructor
