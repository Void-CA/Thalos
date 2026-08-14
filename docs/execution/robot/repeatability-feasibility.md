# Repeatability Feasibility — GATE A (GO/NO-GO)

Calibration-field change — Phase 1. This document is the TEMPLATE for the
physical experiment. Fill in the measured values from the experiment run; the
feasibility report (`calibration_analysis.py report`) computes the actual
numbers from the CSV.

## What this gate proves

The robot must land on the SAME commanded point repeatedly with a dispersion
small enough for the task tolerance. If it cannot repeat, no error map can
compensate the scatter — the project stops (hardware-limited) before any
calibration infrastructure is built. This is why GATE A runs BEFORE Phases
4-6 of the plan.

## Procedure

1. Command ONE reference point (e.g. (0.300, 0.100) m in the work plane)
   N = 10 times:

   ```bash
   python3 firmware/esp32/tools/calibration_driver.py repeatability \
       --port /dev/ttyUSB0 \
       --point-xy 0.30 0.10 --joints <J0> <J1> <J2> <J3> \
       --repetitions 10 --out measurements/repeatability.csv
   ```

   `<J0..J3>` are the joint angles that place the TCP at the reference point
   (solve IK first: `POST /api/v1/scene/solve-ik-position` or the UI). The joint angles
   must be IDENTICAL for every repetition.

2. After each landing, measure where the pen tip actually touches with a
   ruler/caliper and fill `measured_x_m, measured_y_m` in the CSV. This is a
   MANUAL measurement — the robot has no encoders and the script never
   pretends otherwise.

3. Compute the statistics and the Gate A ratio:

   ```bash
   python3 firmware/esp32/tools/calibration_analysis.py repeatability \
       --csv measurements/repeatability.csv --task-tolerance-mm 2.0
   ```

4. Produce this feasibility template with the measured numbers:

   ```bash
   python3 firmware/esp32/tools/calibration_analysis.py report \
       --urdf docs/execution/robot/icebot.urdf \
       --repeatability-csv measurements/repeatability.csv \
       --task-tolerance-mm 2.0
   ```

## Decision rule (operator, not script)

The script prints `required_task_tolerance_mm`, the ratio
`repeatability_floor / task_tolerance`, and SUGGESTS GO when
`radial RMS < task tolerance`, NO-GO otherwise. There is NO magic universal
threshold: the operator compares the measured repeatability floor against the
tolerance the actual task needs and takes the final decision.

## Template result (fill after the experiment)

| Metric | Value (m) | Notes |
|--------|-----------|-------|
| σx | _ | std of measured x over N landings |
| σy | _ | std of measured y over N landings |
| radial RMS | _ | RMS distance of landings from their centroid |
| mean error (measured − commanded) | _ | systematic bias — compensable in Phase 3+ |
| required_task_tolerance_mm | 2.0 | task-dependent parameter |
| repeatability_floor / task_tolerance | _ | ratio printed by the script |

**Decision: GO / NO-GO** — with the measured values and the operator's
reasoning.

## GATE A outcome

- **GO**: continue to Phase 2 (baseline square) and Phase 3 (grid).
- **NO-GO**: STOP. The scatter exceeds the task tolerance; no XY compensation
  can fix it (hardware-limited). Record the measured floor for the decision
  record.
