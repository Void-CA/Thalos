# Pen Tip Fabrication and TCP Measurement Procedure

Calibration-field change — Phase 0 (TCP characterization). This procedure
produces the physical pen tip and the measured TCP offset that feeds
`docs/robot/icebot.urdf` (`tcp_joint` origin) and every calibration
measurement that follows.

## Goal

- A simple, repeatable pen holder that draws on the work plane.
- A measured TCP offset (meters) so the backend's FK predicts where the pen
  tip actually touches.
- A verified FK→TCP chain before any repeatability measurement (GATE A).

## 1. Fabricate the pen tip (simple cylinder + funnel)

Materials: a small cylinder (e.g. a 3D-printed or machined part, ~20-40 mm
long), an 8 mm rod hole along its axis, and a funnel/counterbore on the
drawing end that seats the pen (e.g. a standard ballpoint pen body).

1. The cylinder mounts on the prismatic rod (axis_3, 8 mm rod).
2. The funnel end holds the pen so the pen tip extends a FIXED distance from
   the cylinder face. Glue or a set screw locks the pen — the pen must NEVER
   move between measurements, or every measurement after the change is
   invalid.
3. The pen must sit concentric with the rod axis: the tip touches the plane
   at a single point, not an ellipse (an ellipse means the pen is tilted).

## 2. Measure the physical TCP length (ruler/caliper)

1. With the arm in a known, repeatable pose (all joints at a documented
   neutral), measure from the `end_effector` datum (the physical flange /
   rod shoulder) to the pen tip contact point.
2. Take 3 measurements, rotate the assembly between them, and use the mean.
   Record with at least 3 decimals in METERS (e.g. 0.145 m, not 14.5 cm).
3. Update `docs/robot/icebot.urdf`:
   - `tcp_joint` origin `xyz="0 0 -0.12"` (current baseline) → the measured
     offset (negative Z: the tip points down).
   - Follow the XML comment above `tcp_joint`: procedure + FK verification.
4. Do NOT change the origin to a guessed value. The offset is a physical
   measurement, not a design decision.

## 3. Verify FK → TCP

The backend FK must agree with the physical tip. Two checks:

1. **FK readout**: start the backend and POST `/api/v1/scene/from-fk` with
   the current joint angles (`{"joint_angles": [..]}`). The response contains
   the scene and the active TCP; confirm the reported TCP Z is the measured
   offset below the flange (0 − measured length), and that moving one joint
   changes the TCP position in the direction the arm actually moves.
2. **Z contact test**: with `firmware/esp32/tools/move_joint.py`, move the
   prismatic joint (joint 3) down in tiny steps (use `--range 0.005` first —
   the mapping is ultra-sensitive) and confirm the pen tip touches the plane
   when FK says Z = plane height. If the tip touches early/late, re-check the
   measured length.

Only after this verification are the commanded XY positions from the backend
trustworthy enough for repeatability (Phase 1) and grid (Phase 3) data.

## 4. What feeds the calibration experiment

| Artifact | Value |
|----------|-------|
| `tcp_joint` origin | measured offset in meters (this procedure) |
| URDF hash | `urdf:<sha256-12>` — the feasibility report prints it |
| Pen fixity | checked before every acquisition session |
