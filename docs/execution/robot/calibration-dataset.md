# Calibration Dataset — Grid Acquisition (Phase 3, GATE B)

Calibration-field change — Phase 3. Template for the grid acquisition that
produces the calibration dataset consumed by the Slice 2 `CalibrationField`
(`from_samples()`). The dataset is accepted at GATE B; only then are Phases
4-6 (core types, planning integration, runtime/API) applied.

## Procedure

1. Generate the 3×3 grid target JSON (NINE nodes — not 5×5 in this phase):

   ```bash
   python3 firmware/esp32/tools/calibration_driver.py targets --grid \
       --rows 3 --cols 3 --width-m 0.08 --height-m 0.08 \
       --center-xy 0.30 0.10 --out targets/grid_3x3.json
   ```

2. For every node, solve IK (`POST /api/v1/scene/from-fk` or the UI) and
   fill the `joints` array in the JSON. The commanded XY stays as generated;
   the joints are the physical way to reach it.
   (solve IK via `POST /api/v1/scene/solve-ik-position` or the UI.)

3. Execute the grid — and repeat it 2–3 times. The analysis separates the
   systematic error (mean of the repetitions per node) from the variation
   (std per node): systematic is compensable, variation is the repeatability
   floor and is NOT compensable.

   ```bash
   python3 firmware/esp32/tools/calibration_driver.py grid \
       --port /dev/ttyUSB0 --targets targets/grid_3x3.json \
       --out measurements/grid_rep1.csv
   # run the same command with grid_rep2.csv / grid_rep3.csv
   ```

4. After every repetition, measure each of the 9 landings with the
   ruler/caliper and fill `measured_x_m, measured_y_m` in each rep CSV.

5. Compute systematic vs variation and emit the calibration dataset:

   ```bash
   python3 firmware/esp32/tools/calibration_analysis.py grid-analysis \
       --csvs measurements/grid_rep1.csv measurements/grid_rep2.csv \
       --out measurements/calibration_dataset.csv
   ```

6. Produce the feasibility report including the grid section:

   ```bash
   python3 firmware/esp32/tools/calibration_analysis.py report \
       --urdf docs/execution/robot/icebot.urdf \
       --repeatability-csv measurements/repeatability.csv \
       --baseline-csv measurements/baseline_square.csv \
       --grid-csvs measurements/grid_rep1.csv measurements/grid_rep2.csv \
       --task-tolerance-mm 2.0
   ```

## Dataset format

Same CSV schema as the templates:

```
node_id,commanded_x_m,commanded_y_m,measured_x_m,measured_y_m
n0,0.260000,0.140000,0.261000,0.139500
...
```

`measured_*_m` = the systematic mean over repetitions for that node (6
decimals). This is the exact input Slice 2's `CalibrationField::from_samples()`
needs: 9 non-collinear commanded/measured pairs in meters.

## Template result (fill after the experiment)

| Node | Systematic error (m) | Radial std (m) | Reps |
|------|----------------------|----------------|------|
| n0 | _ | _ | _ |
| n1 | _ | _ | _ |
| … | | | |
| n8 | _ | _ | _ |

| Metric | Value |
|--------|-------|
| dataset file | measurements/calibration_dataset.csv |
| nodes | 9 (3 × 3) |
| mean systematic magnitude | _ m |
| mean radial variation (std) | _ m |

## GATE B outcome

- **Dataset accepted**: 9 nodes with commanded + systematic measured values,
  recorded with the URDF hash of the active URDF and the TCP offset used.
  Phases 4–6 may start.
- **Dataset rejected**: re-check TCP measurement, pen fixity, or the
  repeatability floor (GATE A) before re-acquiring.
