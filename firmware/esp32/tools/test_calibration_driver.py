#!/usr/bin/env python3
"""Unit tests for calibration_driver.py (no hardware, no pyserial required).

Run (from repo root):
    python3 -m unittest firmware.esp32.tools.test_calibration_driver
    python3 -m unittest discover -s firmware/esp32/tools -p "test_*.py"
    python3 firmware/esp32/tools/test_calibration_driver.py
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import calibration_driver as drv  # noqa: E402


class GridGenerationTest(unittest.TestCase):
    """CF-10: 3x3 grid (NINE nodes, NOT 5x5 yet), centered, raster order."""

    def test_default_3x3_grid_has_nine_nodes(self):
        nodes = drv.generate_grid()
        self.assertEqual(len(nodes), 9)
        self.assertEqual(len(set(nodes)), 9, "nodes must be distinct")

    def test_grid_layout_and_centering(self):
        nodes = drv.generate_grid(rows=3, cols=3, width_m=0.08, height_m=0.08,
                                  center_xy=(0.30, 0.10))
        # Float geometry is exact to meter-precision (6 decimals); use
        # almost-equal instead of brittle binary-exact equality.
        self.assertAlmostEqual(nodes[0][0], 0.26, places=9)
        self.assertAlmostEqual(nodes[0][1], 0.14, places=9)
        self.assertAlmostEqual(nodes[4][0], 0.30, places=9)
        self.assertAlmostEqual(nodes[4][1], 0.10, places=9)
        self.assertAlmostEqual(nodes[8][0], 0.34, places=9)
        self.assertAlmostEqual(nodes[8][1], 0.06, places=9)
        self.assertAlmostEqual(nodes[6][0], 0.26, places=9)
        self.assertAlmostEqual(nodes[2][1], 0.14, places=9)

    def test_spacing_derived_from_size_and_node_count(self):
        # 3x3 over 80 mm -> 40 mm spacing; 5x5 over 80 mm -> 20 mm spacing.
        nodes_3x3 = drv.generate_grid(rows=3, cols=3, width_m=0.08, height_m=0.08,
                                      center_xy=(0.30, 0.10))
        self.assertAlmostEqual(nodes_3x3[1][0] - nodes_3x3[0][0], 0.04, places=9)
        nodes_5x5 = drv.generate_grid(rows=5, cols=5, width_m=0.08, height_m=0.08,
                                      center_xy=(0.30, 0.10))
        self.assertEqual(len(nodes_5x5), 25, "5x5 exists but is NOT the default")
        self.assertAlmostEqual(nodes_5x5[1][0] - nodes_5x5[0][0], 0.02, places=9)

    def test_make_grid_targets_has_ids_and_empty_joints(self):
        targets = drv.make_grid_targets(rows=3, cols=3, width_m=0.08, height_m=0.08,
                                        center_xy=(0.30, 0.10))
        self.assertEqual([t["id"] for t in targets],
                         [f"n{i}" for i in range(9)])
        self.assertEqual(targets[0]["commanded_xy_m"], [0.26, 0.14])
        self.assertIsNone(targets[0]["joints"],
                          "joints are filled by the operator after IK — never by the driver")


class CSVTemplateTest(unittest.TestCase):
    """CF-10: CSV with commanded filled, measured empty, 6 decimals, _m units."""

    def _rows(self):
        targets = drv.make_grid_targets(rows=3, cols=3, width_m=0.08, height_m=0.08,
                                        center_xy=(0.30, 0.10))
        return drv.csv_rows_from_targets(targets)

    def test_csv_template_header_exact(self):
        text = drv.csv_template(self._rows())
        header = text.splitlines()[0]
        self.assertEqual(header.split(","),
                         ["node_id", "commanded_x_m", "commanded_y_m",
                          "measured_x_m", "measured_y_m"])

    def test_csv_template_nine_rows_commanded_filled_measured_empty(self):
        text = drv.csv_template(self._rows())
        lines = text.splitlines()
        self.assertEqual(len(lines), 10, "header + 9 grid rows")
        for line in lines[1:]:
            fields = line.split(",")
            self.assertEqual(len(fields), 5)
            self.assertEqual(fields[3], "", "measured_x_m empty for template")
            self.assertEqual(fields[4], "", "measured_y_m empty for template")

    def test_csv_commanded_six_decimals(self):
        text = drv.csv_template(self._rows())
        center_row = [l for l in text.splitlines()[1:] if l.startswith("n4")][0]
        self.assertEqual(center_row, "n4,0.300000,0.100000,,")

    def test_round_trip_parse(self):
        text = drv.csv_template(self._rows())
        rows = drv.parse_csv_text(text)
        self.assertEqual(len(rows), 9)
        self.assertEqual(rows[0]["node_id"], "n0")
        self.assertAlmostEqual(rows[0]["commanded_x_m"], 0.26)
        self.assertAlmostEqual(rows[4]["commanded_y_m"], 0.10)
        self.assertIsNone(rows[0]["measured_x_m"])


class CSVValidationTest(unittest.TestCase):
    """Schema, 6-decimal formatting and _m unit contract for the template."""

    def test_valid_template_has_no_errors(self):
        targets = drv.make_grid_targets()
        text = drv.csv_template(drv.csv_rows_from_targets(targets))
        self.assertEqual(drv.validate_csv_text(text), [])

    def test_wrong_header_is_rejected(self):
        text = drv.csv_template(drv.csv_rows_from_targets(drv.make_grid_targets()))
        bad = text.replace("node_id,commanded_x_m", "id,commanded_x_m", 1)
        errors = drv.validate_csv_text(bad)
        self.assertTrue(any("node_id" in e for e in errors),
                        f"expected column error, got {errors}")

    def test_non_numeric_commanded_is_rejected(self):
        targets = drv.make_grid_targets()
        text = drv.csv_template(drv.csv_rows_from_targets(targets))
        bad = text.replace("n0,0.260000", "n0,0.26ZZZ", 1)
        errors = drv.validate_csv_text(bad)
        self.assertTrue(any("0.26ZZZ" in e for e in errors))

    def test_wrong_decimal_places_is_rejected(self):
        targets = drv.make_grid_targets()
        text = drv.csv_template(drv.csv_rows_from_targets(targets))
        bad = text.replace("0.260000", "0.26", 1)
        errors = drv.validate_csv_text(bad)
        self.assertTrue(any("6 decimal" in e for e in errors),
                        "commanded values must carry exactly 6 decimals")


class SquareWaypointsTest(unittest.TestCase):
    """Phase 2: 80x80 mm square centered in an reachable zone, 4 corners."""

    def test_four_corners_around_center(self):
        corners = drv.square_waypoints(size_m=0.08, center_xy=(0.30, 0.10))
        expected = [(0.26, 0.06), (0.34, 0.06), (0.34, 0.14), (0.26, 0.14)]
        for got, want in zip(corners, expected):
            self.assertAlmostEqual(got[0], want[0], places=9)
            self.assertAlmostEqual(got[1], want[1], places=9)

    def test_corners_form_square(self):
        corners = drv.square_waypoints(size_m=0.08, center_xy=(0.30, 0.10))
        sides = [drv._dist(corners[i], corners[(i + 1) % 4]) for i in range(4)]
        self.assertAlmostEqual(sides[0], 0.08, places=9)
        self.assertAlmostEqual(max(sides) - min(sides), 0.0, places=9)


class ProtocolSequenceTest(unittest.TestCase):
    """Reuses the HELLO->MANIFEST->SEGMENT->SAMPLE->END_UPLOAD->EXECUTE
    pattern from move_joint.py / calibrate.py — no new protocol."""

    def test_single_waypoint_manifest_messages(self):
        msgs = drv.build_move_manifest(joints=[0.0, 0.8, 1.2, 0.04], dt_us=0)
        self.assertEqual(msgs[0], "HELLO 1")
        self.assertEqual(msgs[1], "MANIFEST 4 1 1")
        self.assertEqual(msgs[2], "SEGMENT 0 movej 0 1")
        self.assertEqual(msgs[3], "SAMPLE 0.0000 0.8000 1.2000 0.0400 0")
        self.assertEqual(msgs[4], "END_UPLOAD")
        self.assertEqual(msgs[5], "EXECUTE")

    def test_joint_values_formatted_four_decimals(self):
        msgs = drv.build_move_manifest(joints=[0.123456, -0.5, 0.0, 0.0], dt_us=1000)
        self.assertIn("SAMPLE 0.1235 -0.5000 0.0000 0.0000 1000", msgs)


class RepeatabilityRowsTest(unittest.TestCase):
    """Phase 1: N repetitions of ONE reference point -> N template rows."""

    def test_repeatability_csv_has_n_rows_same_commanded(self):
        rows = drv.repeatability_rows(commanded_xy=(0.30, 0.10), repetitions=10)
        self.assertEqual(len(rows), 10)
        self.assertTrue(all(r["commanded_xy_m"] == [0.30, 0.10] for r in rows))
        self.assertTrue(all(r["measured_xy_m"] is None for r in rows))

    def test_custom_repetition_count(self):
        rows = drv.repeatability_rows(commanded_xy=(0.30, 0.10), repetitions=3)
        self.assertEqual(len(rows), 3)


class SquareRowsTest(unittest.TestCase):
    """Phase 2: square drawn twice -> corners + closure rows per lap."""

    def test_two_laps_ten_rows(self):
        rows = drv.square_rows(size_m=0.08, center_xy=(0.30, 0.10), laps=2)
        self.assertEqual(len(rows), 10, "2 laps x (4 corners + 1 closure)")
        ids = [r["node_id"] for r in rows]
        self.assertEqual(ids, ["c0", "c1", "c2", "c3", "closure"] * 2)

    def test_closure_row_commanded_is_corner_zero(self):
        rows = drv.square_rows(size_m=0.08, center_xy=(0.30, 0.10), laps=1)
        closure = [r for r in rows if r["node_id"] == "closure"][0]
        c0 = [r for r in rows if r["node_id"] == "c0"][0]
        self.assertEqual(closure["commanded_xy_m"], c0["commanded_xy_m"])


if __name__ == "__main__":
    unittest.main()
