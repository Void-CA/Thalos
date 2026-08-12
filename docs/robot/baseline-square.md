# Baseline Drawing — Square (Phase 2)

Calibration-field change — Phase 2. Template for the baseline square
experiment. Fill the measured values after the physical run.

## Purpose

Before building any error map, characterize the DRAWING baseline: how well
the robot draws a known 80×80 mm square, how much the corners scatter, and
how much the drawn square closes (start point vs end point). This is the
pre-compensation reference the Phase 7 validation compares against.

## Procedure

1. Solve IK for the 4 corners of an 80×80 mm square centered in a reachable
   zone (default center (0.300, 0.100) m):

   | Corner | Commanded XY |
   |--------|--------------|
   | c0 | (0.260, 0.060) |
   | c1 | (0.340, 0.060) |
   | c2 | (0.340, 0.140) |
   | c3 | (0.260, 0.140) |

2. Draw the square twice (each lap ends back at c0):

   ```bash
   python3 tools/calibration_driver.py square \
       --port /dev/ttyUSB0 --size-m 0.08 --center-xy 0.30 0.10 \
       --joints "J0 J1 J2 J3|J0 J1 J2 J3|J0 J1 J2 J3|J0 J1 J2 J3" \
       --laps 2 --out measurements/baseline_square.csv
   ```

   The four joint groups are the IK solution for c0|c1|c2|c3. The driver
   emits 10 template rows (2 laps × [4 corners + 1 closure]).

3. Measure with the ruler/caliper:
   - every corner landing (`c0..c3` rows),
   - the closure gap: where the pen ends the lap vs where it started
     (`closure` rows — commanded = c0).

4. Compute the baseline metrics:

   ```bash
   python3 tools/calibration_analysis.py baseline \
       --csv measurements/baseline_square.csv
   ```

## Metrics

| Metric | Definition |
|--------|-----------|
| corner RMS | RMS of (measured − commanded) over all corner landings |
| closure | mean over laps of the distance from the measured closure landing to commanded c0 |
| width error | \|mean(measured c0→c1 distance) − commanded width\| |
| height error | \|mean(measured c1→c2 distance) − commanded height\| |

## Template result (fill after the experiment)

| Metric | Value (m) |
|--------|-----------|
| corner RMS | _ |
| closure | _ |
| width error | _ |
| height error | _ |

These numbers feed the Calibration Feasibility Report (`report` mode) and
become the Phase 7 "before" baseline.
