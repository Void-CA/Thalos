#!/usr/bin/env python3
"""Unit tests for calibration_analysis.py (pure math, no hardware).

Run (from repo root):
    python3 -m unittest firmware.esp32.tools.test_calibration_analysis
    python3 -m unittest discover -s firmware/esp32/tools -p "test_*.py"
    python3 firmware/esp32/tools/test_calibration_analysis.py
"""
import math
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import calibration_analysis as ana  # noqa: E402
import calibration_driver as drv  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
URDF = os.path.join(REPO_ROOT, "docs", "robot", "icebot.urdf")


class StatsTest(unittest.TestCase):
    def test_mean_and_sample_std(self):
        self.assertAlmostEqual(ana.mean([1, 2, 3, 4, 5]), 3.0, places=9)
        self.assertAlmostEqual(ana.sample_std([1, 2, 3, 4, 5]),
                               1.5811388300841898, places=9)

    def test_sample_std_single_value_is_zero(self):
        self.assertEqual(ana.sample_std([0.1]), 0.0)
        self.assertEqual(ana.sample_std([]), 0.0)


class RadialRMSTest(unittest.TestCase):
    def test_symmetric_landings_around_centroid(self):
        # Landings (1,0) and (-1,0): centroid (0,0), both at distance 1.
        self.assertAlmostEqual(ana.radial_rms([(1.0, 0.0), (-1.0, 0.0)]),
                               1.0, places=9)

    def test_asymmetric_landings(self):
        # (3,0),(0,4): centroid (1.5,2); distances sqrt(1.5^2+2^2)=2.5 each.
        self.assertAlmostEqual(ana.radial_rms([(3.0, 0.0), (0.0, 4.0)]),
                               2.5, places=9)

    def test_no_landings_is_zero(self):
        self.assertEqual(ana.radial_rms([]), 0.0)


def _repeat_rows(command=(0.0, 0.0), measured=None):
    """Build driver-format repeatability rows with the given measured landings."""
    measured = measured or []
    return [{"node_id": "ref", "commanded_xy_m": list(command),
             "measured_xy_m": list(m)} for m in measured]


class RepeatabilityAnalysisTest(unittest.TestCase):
    def test_stats_from_synthetic_landings(self):
        rows = _repeat_rows(command=(0.0, 0.0), measured=[
            (1, 1), (2, 1), (3, 1), (4, 1), (5, 1)])
        res = ana.analyze_repeatability(rows)
        self.assertEqual(res["n"], 5)
        self.assertAlmostEqual(res["mean_xy"][0], 3.0, places=9)
        self.assertAlmostEqual(res["std_x"], 1.5811388300841898, places=9)
        self.assertEqual(res["std_y"], 0.0)
        # radial RMS = sqrt(mean((x-3)^2)) over x = [1..5] -> sqrt(2)
        self.assertAlmostEqual(res["radial_rms"], math.sqrt(2.0), places=9)
        self.assertAlmostEqual(res["mean_error"][0], 3.0, places=9)

    def test_zero_variation_landings(self):
        rows = _repeat_rows(command=(0.100, 0.100),
                            measured=[(0.102, 0.099), (0.102, 0.099)])
        res = ana.analyze_repeatability(rows)
        self.assertEqual(res["std_x"], 0.0)
        self.assertEqual(res["std_y"], 0.0)
        self.assertEqual(res["radial_rms"], 0.0)
        self.assertAlmostEqual(res["mean_error"][0], 0.002, places=9)
        self.assertAlmostEqual(res["mean_error"][1], -0.001, places=9)

    def test_rejects_rows_without_measured(self):
        rows = _repeat_rows(measured=[])
        with self.assertRaises(ValueError):
            ana.analyze_repeatability(rows)


class CSVContractTest(unittest.TestCase):
    """The driver's template and the analysis loader must agree on schema."""

    def test_driver_template_round_trips_through_analysis(self):
        targets = drv.make_grid_targets()
        text = drv.csv_template(drv.csv_rows_from_targets(targets))
        rows = ana.load_csv_text(text)
        self.assertEqual(len(rows), 9)
        self.assertEqual(rows[0]["node_id"], "n0")
        self.assertAlmostEqual(rows[4]["commanded_x_m"], 0.30, places=9)

    def test_measured_values_round_trip(self):
        rows = drv.repeatability_rows(commanded_xy=(0.30, 0.10), repetitions=3)
        rows[0]["measured_xy_m"] = [0.302, 0.098]
        text = drv.csv_template(rows)
        parsed = ana.load_csv_text(text)
        self.assertEqual(parsed[0]["measured_xy_m"], [0.302, 0.098])
        self.assertIsNone(parsed[1]["measured_xy_m"])


def _baseline_rows():
    """Synthetic 1-lap baseline: commanded 80 mm square at (0.30, 0.10)."""
    corners = drv.square_waypoints(size_m=0.08, center_xy=(0.30, 0.10))
    measured = {
        "c0": (0.260, 0.060),
        "c1": (0.342, 0.060),
        "c2": (0.342, 0.142),
        "c3": (0.260, 0.140),
        "closure": (0.262, 0.062),
    }
    rows = []
    for i, xy in enumerate(corners):
        rows.append({"node_id": f"c{i}", "commanded_xy_m": list(xy),
                     "measured_xy_m": list(measured[f"c{i}"])})
    rows.append({"node_id": "closure", "commanded_xy_m": list(corners[0]),
                 "measured_xy_m": list(measured["closure"])})
    return rows


class BaselineAnalysisTest(unittest.TestCase):
    def test_metrics_from_synthetic_square(self):
        res = ana.analyze_baseline(_baseline_rows())
        # corner offsets (0,0),(+2mm,0),(+2mm,+2mm),(0,0):
        # RMS = sqrt((0 + 4e-6 + 8e-6 + 0)/4) = sqrt(3e-6)
        self.assertAlmostEqual(res["corner_rms"], math.sqrt(3e-6), places=9)
        # measured width c0->c1 = 0.082 m -> error 0.002 vs commanded 0.08
        self.assertAlmostEqual(res["width_error"], 0.002, places=9)
        self.assertAlmostEqual(res["height_error"], 0.002, places=9)
        # closure: distance((0.262,0.062), commanded c0 (0.26,0.06))
        self.assertAlmostEqual(res["closure"], math.sqrt(8e-6), places=9)

    def test_perfect_square_has_zero_errors(self):
        corners = drv.square_waypoints(size_m=0.08, center_xy=(0.30, 0.10))
        rows = [{"node_id": f"c{i}", "commanded_xy_m": list(xy),
                 "measured_xy_m": list(xy)} for i, xy in enumerate(corners)]
        rows.append({"node_id": "closure", "commanded_xy_m": list(corners[0]),
                     "measured_xy_m": list(corners[0])})
        res = ana.analyze_baseline(rows)
        self.assertEqual(res["corner_rms"], 0.0)
        self.assertEqual(res["width_error"], 0.0)
        self.assertEqual(res["height_error"], 0.0)
        self.assertEqual(res["closure"], 0.0)


def _grid_rep_files():
    """Two repetitions of a 3x3 grid; node i measured = commanded + bias_i
    + rep noise (+/-0.0002). bias_i = (0.001 + 0.0001*i, -0.0005)."""
    nodes = drv.generate_grid(rows=3, cols=3, width_m=0.08, height_m=0.08,
                              center_xy=(0.30, 0.10))
    reps = []
    for rep, sign in ((0, +0.0002), (1, -0.0002)):
        rows = []
        for i, (x, y) in enumerate(nodes):
            bias = (0.001 + 0.0001 * i, -0.0005)
            rows.append({"node_id": f"n{i}", "commanded_xy_m": [x, y],
                         "measured_xy_m": [x + bias[0] + sign,
                                           y + bias[1] + sign]})
        reps.append(rows)
    return reps, nodes


class GridAnalysisTest(unittest.TestCase):
    def test_systematic_separated_from_variation(self):
        reps, nodes = _grid_rep_files()
        res = ana.analyze_grid(reps)
        self.assertEqual(len(res["nodes"]), 9)
        n0 = res["nodes"]["n0"]
        self.assertAlmostEqual(n0["systematic_xy"][0],
                               0.26 + 0.001, places=9)
        self.assertAlmostEqual(n0["systematic_xy"][1],
                               0.14 - 0.0005, places=9)
        # injected noise +/-0.0002 -> sample std = 0.0002828
        self.assertAlmostEqual(n0["std_x"], math.sqrt(8e-8), places=9)
        n8 = res["nodes"]["n8"]
        self.assertAlmostEqual(n8["systematic_xy"][0],
                               0.34 + 0.0018, places=9)

    def test_dataset_uses_systematic_means(self):
        reps, nodes = _grid_rep_files()
        res = ana.analyze_grid(reps)
        dataset = res["dataset"]
        self.assertEqual(len(dataset), 9)
        self.assertEqual(dataset[0]["node_id"], "n0")
        self.assertAlmostEqual(dataset[0]["measured_xy_m"][0],
                               0.26 + 0.001, places=9)
        self.assertEqual(dataset[4]["commanded_xy_m"], [0.30, 0.10])

    def test_dataset_written_to_csv_with_six_decimals(self):
        reps, nodes = _grid_rep_files()
        res = ana.analyze_grid(reps)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "dataset.csv")
            ana.write_dataset_csv(path, res["dataset"])
            with open(path, encoding="utf-8") as f:
                text = f.read()
            rows = ana.load_csv_text(text)
            self.assertEqual(len(rows), 9)
            header = text.splitlines()[0].split(",")
            self.assertEqual(header[1], "commanded_x_m")
            for line in text.splitlines()[1:]:
                self.assertNotIn("e-0", line, "6-decimal formatting required")
                self.assertEqual(len(line.split(",")[1].split(".")[1]), 6)


class URDFIdentityTest(unittest.TestCase):
    def test_hash_tcp_and_robot_name(self):
        ident = ana.urdf_identity(URDF)
        self.assertEqual(ident["robot"], "icebot")
        self.assertRegex(ident["hash"], r"^urdf:[0-9a-f]{12}$")
        self.assertAlmostEqual(ident["tcp_origin"][2], -0.12, places=9)

    def test_hash_is_content_based(self):
        ident = ana.urdf_identity(URDF)
        with tempfile.TemporaryDirectory() as tmp:
            other = os.path.join(tmp, "other.urdf")
            with open(URDF, encoding="utf-8") as f:
                original = f.read()
            with open(other, "w", encoding="utf-8") as f:
                f.write(original + "<!-- x -->")
            self.assertNotEqual(ana.urdf_identity(other)["hash"],
                                ident["hash"])


class DecisionTest(unittest.TestCase):
    def test_go_when_radial_rms_under_tolerance(self):
        decision, reason = ana.suggest_decision(radial_rms_m=0.0005,
                                                task_tolerance_mm=2.0)
        self.assertEqual(decision, "GO")
        self.assertIn("0.500", reason)

    def test_no_go_when_radial_rms_at_or_over_tolerance(self):
        decision, _ = ana.suggest_decision(radial_rms_m=0.002,
                                           task_tolerance_mm=2.0)
        self.assertEqual(decision, "NO-GO", "boundary is strictly less than")
        decision, _ = ana.suggest_decision(radial_rms_m=0.003,
                                           task_tolerance_mm=2.0)
        self.assertEqual(decision, "NO-GO")


class ReportFormatTest(unittest.TestCase):
    def _repeat_rows(self):
        return _repeat_rows(command=(0.30, 0.10), measured=[
            (0.301, 0.099), (0.302, 0.098), (0.301, 0.099),
            (0.303, 0.097), (0.301, 0.099), (0.302, 0.098),
            (0.302, 0.098), (0.301, 0.099), (0.303, 0.097), (0.301, 0.099)])

    def test_report_structure_exact(self):
        ident = ana.urdf_identity(URDF)
        rep = ana.analyze_repeatability(self._repeat_rows())
        report = ana.render_feasibility_report(
            robot=ident["robot"], urdf_hash=ident["hash"],
            tcp=ident["tcp_desc"], rep_analysis=rep,
            task_tolerance_mm=2.0)
        lines = report.splitlines()
        self.assertEqual(lines[0], "Calibration Feasibility Report")
        # The report renders the ACTUAL robot name from the URDF file.
        self.assertEqual(lines[1], f"Robot: {ident['robot']}")
        self.assertRegex(lines[2], r"^URDF hash: urdf:[0-9a-f]{12}$")
        self.assertTrue(lines[3].startswith("TCP: "))
        self.assertEqual(lines[4], "Reference point: (0.300000, 0.100000) m")
        self.assertEqual(lines[5], "  repetitions: 10")
        self.assertEqual(lines[6], "Repeatability:")
        self.assertTrue(lines[7].startswith("  \u03c3x: "), "sigma x line")
        self.assertTrue(lines[8].startswith("  \u03c3y: "), "sigma y line")
        self.assertTrue(lines[9].startswith("  radial RMS: "),
                        "radial RMS line")
        self.assertIn("Baseline square: (Phase 2)", lines)
        self.assertIn("Grid: (Phase 3)", lines)
        self.assertTrue(lines[-2].startswith("Decision: "),
                        f"decision line missing: {lines}")
        self.assertTrue(lines[-1].startswith("Reason: "))

    def test_report_values_match_analysis(self):
        ident = ana.urdf_identity(URDF)
        rep = ana.analyze_repeatability(self._repeat_rows())
        report = ana.render_feasibility_report(
            robot=ident["robot"], urdf_hash=ident["hash"],
            tcp=ident["tcp_desc"], rep_analysis=rep,
            task_tolerance_mm=2.0)
        sigma_x = f"{rep['std_x']:.6f}"
        self.assertIn(f"  \u03c3x: {sigma_x} m", report)
        self.assertIn(f"  radial RMS: {rep['radial_rms']:.6f} m", report)
        ratio = rep["radial_rms"] * 1000.0 / 2.0
        self.assertIn(f"repeatability_floor / task_tolerance: {ratio:.3f}",
                      report)

    def test_report_decision_pending_without_data(self):
        report = ana.render_feasibility_report(
            robot="icebot", urdf_hash="urdf:000000000000", tcp="n/a",
            rep_analysis=None, task_tolerance_mm=2.0)
        self.assertIn("Decision: PENDING", report)
        self.assertIn("repeatability measurement required", report)

    def test_full_report_with_grid_has_go_decision(self):
        ident = ana.urdf_identity(URDF)
        rep = ana.analyze_repeatability(self._repeat_rows())
        baseline = ana.analyze_baseline(_baseline_rows())
        reps, _ = _grid_rep_files()
        grid = ana.analyze_grid(reps)
        report = ana.render_feasibility_report(
            robot=ident["robot"], urdf_hash=ident["hash"],
            tcp=ident["tcp_desc"], rep_analysis=rep,
            baseline_analysis=baseline, grid_analysis=grid,
            task_tolerance_mm=2.0)
        self.assertIn("3 \u00d7 3", report)
        self.assertIn("samples: 9", report)
        self.assertIn("corner RMS: ", report)
        self.assertIn("closure: ", report)
        self.assertIn("Decision: GO", report)


if __name__ == "__main__":
    unittest.main()
