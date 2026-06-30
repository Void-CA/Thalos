# Thalos Canonical Coordinate System

**Canonical reference:** ADR-0001  
**Status:** Target state (migration in progress)

## Convention

Right-handed coordinate system.

X × Y = Z

| Axis | Direction | Semantic |
|------|-----------|----------|
| X | Forward | Sagittal (front of the robot) |
| Y | Left | Lateral |
| Z | Up | Vertical (zenith) |

## Rules

1. **All FK, IK, planning, workspace analysis, and URDF import operate in canonical coordinates.** No subsystem introduces its own convention.

2. **Renderers may adapt coordinates for display** but must never alter canonical data. Renderers are consumers of canonical data, not producers. The adapter boundary is the renderer, not the domain.

3. **URDF import is passthrough** — URDF's native Z-up matches Thalos canonical. No conversion applied.

4. **`.z` means `height`** — any code that reads or writes a vertical coordinate uses `.z`, never `.y`.

5. **Joint axes** — vertical rotation (yaw) uses `z_axis()`. Horizontal rotations use `x_axis()` or `y_axis()`. Prismatic joints along the vertical use `z_axis()`.

## Model conventions

| Model | Joint axes | Notes |
|-------|-----------|-------|
| SCARA | Z, Z, Z, Z | All revolute around Z (yaw). Prismatic along Z. |
| Planar 2R | Z, Z | XY plane horizontal. |
| Planar 3R | Z, Z, Z | XY plane horizontal. |
| Single Revolute | Z | XY plane horizontal. |
| Manipulator 3DOF | Z, Z, Z | Yaw around Z, shoulder/elbow around Z (serial). |
| Cylindrical RPP | Z (rev), Z (pris), X (pris) | Azimuth around Z, elevation along Z, radial in X. |
| Spherical Polar RRP | Z (rev), Z (rev), X (pris) | Azimuth and polar both rotate around Z. Radial in X. |
| URDF import | Per URDF | Passthrough — no conversion. |

## Renderer adaptation

Three.js defaults to Y-up (cameras, CylinderGeometry, OrbitControls).  
The renderer must explicitly configure Z-up via `camera.up.set(0, 0, 1)`.

See `docs/adr/ADR-0001-z-up-canonical-coordinates.md` for the full decision record and migration plan.
