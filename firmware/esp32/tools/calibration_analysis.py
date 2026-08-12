#!/usr/bin/env python3
"""Thalos — calibration analysis and Calibration Feasibility Report.

Turns the human-measured CSVs produced by calibration_driver.py into the
statistics the physical gates need (Phases 1-3 of the calibration-field
change). Pure computation: no serial, no pyserial.

Modes:

    repeatability    Phase 1 (GATE A): mean, sigma_x, sigma_y and radial RMS
                     of N repetitions of ONE reference point, plus the Gate A
                     ratio repeatability_floor / task_tolerance. The decision
                     is EXPLICITLY the operator's: the script prints both
                     values and suggests GO when radial RMS < task tolerance,
                     NO-GO otherwise — no magic universal threshold.
    baseline         Phase 2: corner RMS, closure error, width/height error
                     of the drawn square (measured vs commanded).
    grid-analysis    Phase 3: separates systematic error (mean of the grid
                     repetitions per node) from variation (std per node) and
                     writes the calibration dataset CSV (commanded XY +
                     systematic measured mean) for the Slice 2 CalibrationField.
    report           Full Calibration Feasibility Report combining every
                     section above with the EXACT format below.

CSV schema (must match calibration_driver.py):
    node_id | commanded_x_m | commanded_y_m | measured_x_m | measured_y_m
commanded values carry exactly 6 decimals, meters. measured values are
human ruler/caliper readings (never firmware-reported — there are no encoders).

Calibration Feasibility Report format:
    Calibration Feasibility Report
    Robot: Icebot
    URDF hash: <urdf:<sha256-12> of the active URDF>
    TCP: <description of tcp_joint>
    Reference point: <commanded xyz>
      repetitions: N
    Repeatability:
      σx: ...
      σy: ...
      radial RMS: ...
      mean error (measured - commanded): ...
      required_task_tolerance_mm: ...
      repeatability_floor / task_tolerance: ...
    Baseline square: (Phase 2)
      corner RMS: ...
      closure: ...
      width error: ...
      height error: ...
    Grid: (Phase 3)
      3 × 3
      samples: 9
    Decision: GO / NO-GO / PENDING
    Reason: ...

Usage:
    python3 tools/calibration_analysis.py repeatability \
        --csv measurements/repeatability.csv --task-tolerance-mm 2.0
    python3 tools/calibration_analysis.py baseline \
        --csv measurements/baseline_square.csv
    python3 tools/calibration_analysis.py grid-analysis \
        --csvs measurements/grid_rep1.csv measurements/grid_rep2.csv \
        --out measurements/calibration_dataset.csv
    python3 tools/calibration_analysis.py report \
        --urdf docs/robot/icebot.urdf \
        --repeatability-csv measurements/repeatability.csv \
        --baseline-csv measurements/baseline_square.csv \
        --grid-csvs measurements/grid_rep1.csv measurements/grid_rep2.csv \
        --task-tolerance-mm 2.0
"""
import argparse
import hashlib
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

# CSV contract — MUST match calibration_driver.py.
CSV_COLUMNS = ["node_id", "commanded_x_m", "commanded_y_m",
               "measured_x_m", "measured_y_m"]


# ── CSV loading (same schema as calibration_driver.py) ────────────────────

def load_csv_text(text):
    """Parse template text -> list of dicts. Raises ValueError on malformed rows."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        raise ValueError("empty CSV")
    header = lines[0].split(",")
    if header != CSV_COLUMNS:
        raise ValueError(f"invalid header {header!r}; expected {CSV_COLUMNS!r}")
    rows = []
    for i, line in enumerate(lines[1:], start=2):
        fields = line.split(",")
        if len(fields) != len(CSV_COLUMNS):
            raise ValueError(f"row {i}: expected {len(CSV_COLUMNS)} fields, "
                             f"got {len(fields)}: {line!r}")
        row = {"node_id": fields[0]}
        try:
            row["commanded_x_m"] = float(fields[1])
            row["commanded_y_m"] = float(fields[2])
        except ValueError:
            raise ValueError(f"row {i}: commanded must be numeric: {line!r}")
        row["commanded_xy_m"] = [row["commanded_x_m"], row["commanded_y_m"]]
        if fields[3] == "" and fields[4] == "":
            row["measured_x_m"] = None
            row["measured_y_m"] = None
            row["measured_xy_m"] = None
        else:
            try:
                row["measured_x_m"] = float(fields[3])
                row["measured_y_m"] = float(fields[4])
            except ValueError:
                raise ValueError(f"row {i}: measured must be numeric or "
                                 f"empty: {line!r}")
            row["measured_xy_m"] = [row["measured_x_m"], row["measured_y_m"]]
        rows.append(row)
    return rows


def load_csv(path):
    with open(path, encoding="utf-8") as f:
        return load_csv_text(f.read())


# ── Statistics (pure) ─────────────────────────────────────────────────────

def mean(xs):
    xs = list(xs)  # accepts lists AND generators
    if not xs:
        return 0.0
    return sum(xs) / len(xs)


def sample_std(xs):
    """Sample standard deviation (ddof=1). 0.0 for n < 2 (undefined)."""
    n = len(xs)
    if n < 2:
        return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def radial_rms(measured_xy):
    """RMS distance of each landing from the centroid of all landings."""
    if not measured_xy:
        return 0.0
    cx, cy = mean([p[0] for p in measured_xy]), mean([p[1] for p in measured_xy])
    squared = [(x - cx) ** 2 + (y - cy) ** 2 for x, y in measured_xy]
    return math.sqrt(mean(squared))


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


# ── Phase 1: repeatability ────────────────────────────────────────────────

def analyze_repeatability(rows):
    """Compute sigma_x, sigma_y, radial RMS and mean error for ONE reference
    point (all rows share the same commanded XY)."""
    measured = [r["measured_xy_m"] for r in rows if r["measured_xy_m"] is not None]
    if not measured:
        raise ValueError("no measured values: fill measured_*_m by hand first "
                         "(Phase 1 requires ruler/caliper measurements)")
    mx = [p[0] for p in measured]
    my = [p[1] for p in measured]
    mean_xy = [mean(mx), mean(my)]
    commanded = rows[0]["commanded_xy_m"]
    return {
        "n": len(measured),
        "commanded_xy": commanded,
        "mean_xy": mean_xy,
        "std_x": sample_std(mx),
        "std_y": sample_std(my),
        "radial_rms": radial_rms(measured),
        "mean_error": [mean_xy[0] - commanded[0], mean_xy[1] - commanded[1]],
    }


# ── Phase 2: baseline square ──────────────────────────────────────────────

def analyze_baseline(rows):
    """Corner RMS, closure error, width/height error from a baseline square.

    The commanded square is derived from the CSV's commanded corner columns
    (c0..c3). Closure rows have node_id 'closure' and commanded = corner 0.
    """
    corners = {r["node_id"]: r
               for r in rows
               if r["node_id"] in ("c0", "c1", "c2", "c3")
               and r["measured_xy_m"] is not None}
    if len(corners) < 4:
        raise ValueError("baseline needs measured c0..c3 rows")
    cmd = [corners[f"c{i}"]["commanded_xy_m"] for i in range(4)]
    width_cmd = _dist(cmd[0], cmd[1])
    height_cmd = _dist(cmd[1], cmd[2])

    corner_errs = [_dist(corners[f"c{i}"]["measured_xy_m"], cmd[i])
                   for i in range(4)]
    corner_rms = math.sqrt(mean(e ** 2 for e in corner_errs))

    # Group laps: rows are emitted lap-major (c0,c1,c2,c3,closure)*laps.
    widths, heights, closures = [], [], []
    lap = {}
    for r in rows:
        if r["measured_xy_m"] is None:
            continue
        if r["node_id"] in ("c0", "c1", "c2", "c3"):
            lap[r["node_id"]] = r["measured_xy_m"]
        elif r["node_id"] == "closure":
            if {"c0", "c1", "c2", "c3"} <= set(lap):
                widths.append(_dist(lap["c1"], lap["c0"]))
                heights.append(_dist(lap["c2"], lap["c1"]))
                closures.append(_dist(r["measured_xy_m"], cmd[0]))
            lap = {}
    return {
        "corner_rms": corner_rms,
        "closure": mean(closures) if closures else None,
        "width_error": abs(mean(widths) - width_cmd) if widths else None,
        "height_error": abs(mean(heights) - height_cmd) if heights else None,
        "width_cmd": width_cmd,
        "height_cmd": height_cmd,
        "laps": len(widths),
    }


# ── Phase 3: grid systematic vs variation ─────────────────────────────────

def analyze_grid(reps):
    """Separate systematic error (mean over repetitions per node) from
    variation (std per node). `reps` is a list of row-lists (one per grid
    repetition). Returns per-node stats plus the calibration dataset (each
    node measured = systematic mean) that Slice 2's CalibrationField consumes.
    """
    by_node = {}
    for rep in reps:
        for r in rep:
            if r["measured_xy_m"] is None:
                continue
            by_node.setdefault(r["node_id"], []).append(r)
    nodes = {}
    for node_id, rs in sorted(by_node.items()):
        mx = [r["measured_xy_m"][0] for r in rs]
        my = [r["measured_xy_m"][1] for r in rs]
        systematic = [mean(mx), mean(my)]
        nodes[node_id] = {
            "systematic_xy": systematic,
            "std_x": sample_std(mx),
            "std_y": sample_std(my),
            "radial_std": math.sqrt(sample_std(mx) ** 2 + sample_std(my) ** 2),
            "reps": len(rs),
            "commanded_xy": rs[0]["commanded_xy_m"],
        }
    dataset = [
        {"node_id": nid, "commanded_xy_m": n["commanded_xy"],
         "measured_xy_m": n["systematic_xy"]}
        for nid, n in nodes.items()
    ]
    return {"nodes": nodes, "dataset": dataset}


def write_dataset_csv(path, dataset):
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    lines = [",".join(CSV_COLUMNS)]
    for d in dataset:
        cx, cy = d["commanded_xy_m"]
        mx, my = d["measured_xy_m"]
        lines.append(f"{d['node_id']},{cx:.6f},{cy:.6f},{mx:.6f},{my:.6f}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[OK ] calibration dataset: {path} "
          f"({len(dataset)} nodes, measured = systematic mean)")


# ── URDF identity (same rule as backend urdf_robot_id) ────────────────────

def urdf_identity(urdf_path):
    """robot name, 'urdf:<sha256-12>' hash of the RAW bytes (matching the
    backend rule sha256[..6] -> 12 hex chars) and tcp_joint origin."""
    with open(urdf_path, "rb") as f:
        raw = f.read()
    digest = hashlib.sha256(raw).hexdigest()[:12]
    root = ET.fromstring(raw)
    robot = root.get("name", "unknown")
    tcp_origin = None
    for joint in root.iter("joint"):
        if joint.get("name") == "tcp_joint":
            origin = joint.find("origin")
            if origin is not None:
                xyz = origin.get("xyz", "0 0 0").split()
                tcp_origin = tuple(float(v) for v in xyz[:3])
    if tcp_origin is None:
        raise ValueError(f"tcp_joint not found in {urdf_path}")
    tcp_desc = (f"tcp_joint (fixed) to tool0, origin "
                f"({tcp_origin[0]:.3f}, {tcp_origin[1]:.3f}, "
                f"{tcp_origin[2]:.3f}) m — baseline; re-measure after pen tip "
                f"mount (see docs/robot/pen-tip-procedure.md)")
    return {"robot": robot, "hash": f"urdf:{digest}", "tcp_origin": tcp_origin,
            "tcp_desc": tcp_desc}


# ── GATE A decision ───────────────────────────────────────────────────────

def suggest_decision(radial_rms_m, task_tolerance_mm):
    """Suggest GO / NO-GO. Strictly: GO iff radial RMS < task tolerance.
    The OPERATOR takes the final decision — no magic universal threshold."""
    tol_m = task_tolerance_mm / 1000.0
    if radial_rms_m < tol_m:
        reason = (f"radial RMS {radial_rms_m * 1000.0:.3f} mm < task tolerance "
                  f"{task_tolerance_mm:.3f} mm — repeatability floor is "
                  f"acceptable for the task")
        return "GO", reason
    reason = (f"radial RMS {radial_rms_m * 1000.0:.3f} mm >= task tolerance "
              f"{task_tolerance_mm:.3f} mm — repeatability floor exceeds the "
              f"task tolerance; hardware-limited")
    return "NO-GO", reason


# ── Feasibility report ────────────────────────────────────────────────────

def render_feasibility_report(robot, urdf_hash, tcp, rep_analysis=None,
                              baseline_analysis=None, grid_analysis=None,
                              task_tolerance_mm=2.0):
    """Render the Calibration Feasibility Report (exact format, English)."""
    lines = [
        "Calibration Feasibility Report",
        f"Robot: {robot}",
        f"URDF hash: {urdf_hash}",
        f"TCP: {tcp}",
    ]
    if rep_analysis is not None:
        rx, ry = rep_analysis["commanded_xy"]
        lines.append(f"Reference point: ({rx:.6f}, {ry:.6f}) m")
        lines.append(f"  repetitions: {rep_analysis['n']}")
        lines.append("Repeatability:")
        lines.append(f"  \u03c3x: {rep_analysis['std_x']:.6f} m")
        lines.append(f"  \u03c3y: {rep_analysis['std_y']:.6f} m")
        lines.append(f"  radial RMS: {rep_analysis['radial_rms']:.6f} m")
        ex, ey = rep_analysis["mean_error"]
        lines.append(f"  mean error (measured - commanded): ({ex:.6f}, "
                     f"{ey:.6f}) m")
        lines.append(f"  required_task_tolerance_mm: "
                     f"{task_tolerance_mm:.3f}")
        ratio = (rep_analysis["radial_rms"] * 1000.0) / task_tolerance_mm
        lines.append(f"  repeatability_floor / task_tolerance: {ratio:.3f}")
    else:
        lines.append("Reference point: n/a (run Phase 1)")
        lines.append("Repeatability: n/a (run Phase 1)")

    lines.append("Baseline square: (Phase 2)")
    if baseline_analysis is not None:
        b = baseline_analysis
        lines.append(f"  corner RMS: {b['corner_rms']:.6f} m")
        lines.append(f"  closure: {b['closure']:.6f} m")
        lines.append(f"  width error: {b['width_error']:.6f} m")
        lines.append(f"  height error: {b['height_error']:.6f} m")
    else:
        lines.append("  corner RMS: n/a (run Phase 2)")
        lines.append("  closure: n/a (run Phase 2)")
        lines.append("  width error: n/a (run Phase 2)")
        lines.append("  height error: n/a (run Phase 2)")

    lines.append("Grid: (Phase 3)")
    if grid_analysis is not None:
        nodes = grid_analysis["nodes"]
        # Systematic MAGNITUDE = |systematic - commanded| (the error vector),
        # not the absolute position.
        sys_mags = [math.hypot(n["systematic_xy"][0] - n["commanded_xy"][0],
                               n["systematic_xy"][1] - n["commanded_xy"][1])
                    for n in nodes.values()]
        var = [n["radial_std"] for n in nodes.values()]
        lines.append(f"  {3} \u00d7 {3}")
        lines.append(f"  samples: {len(nodes)}")
        lines.append(f"  mean systematic magnitude: {mean(sys_mags):.6f} m")
        lines.append(f"  mean radial variation (std): {mean(var):.6f} m")
    else:
        lines.append(f"  {3} \u00d7 {3}")
        lines.append("  samples: n/a (run Phase 3)")

    if rep_analysis is None:
        lines.append("Decision: PENDING")
        lines.append("Reason: repeatability measurement required (Phase 1) "
                     "before GATE A")
    else:
        decision, reason = suggest_decision(rep_analysis["radial_rms"],
                                            task_tolerance_mm)
        lines.append(f"Decision: {decision} (suggested — operator confirms)")
        lines.append(f"Reason: {reason}")
    return "\n".join(lines) + "\n"


# ── CLI ───────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Thalos calibration analysis + feasibility report "
                    "(Phases 1-3)")
    sub = ap.add_subparsers(dest="mode", required=True)

    p_rep = sub.add_parser("repeatability",
                           help="Phase 1: sigma/radial RMS of N repetitions")
    p_rep.add_argument("--csv", required=True)
    p_rep.add_argument("--task-tolerance-mm", type=float, default=2.0)

    p_base = sub.add_parser("baseline", help="Phase 2: square metrics")
    p_base.add_argument("--csv", required=True)

    p_grid = sub.add_parser("grid-analysis",
                            help="Phase 3: systematic vs variation per node")
    p_grid.add_argument("--csvs", nargs="+", required=True)
    p_grid.add_argument("--out", default="measurements/calibration_dataset.csv")

    p_rep_full = sub.add_parser("report", help="full Calibration Feasibility Report")
    p_rep_full.add_argument("--urdf", default=os.path.join(
        "docs", "robot", "icebot.urdf"))
    p_rep_full.add_argument("--repeatability-csv")
    p_rep_full.add_argument("--baseline-csv")
    p_rep_full.add_argument("--grid-csvs", nargs="+")
    p_rep_full.add_argument("--task-tolerance-mm", type=float, default=2.0)

    args = ap.parse_args()

    if args.mode == "repeatability":
        rep = analyze_repeatability(load_csv(args.csv))
        print(f"n={rep['n']}  commanded={rep['commanded_xy']}")
        print(f"mean measured: ({rep['mean_xy'][0]:.6f}, "
              f"{rep['mean_xy'][1]:.6f}) m")
        print(f"sigma_x: {rep['std_x']:.6f} m")
        print(f"sigma_y: {rep['std_y']:.6f} m")
        print(f"radial RMS: {rep['radial_rms']:.6f} m")
        print(f"mean error (measured - commanded): "
              f"({rep['mean_error'][0]:.6f}, {rep['mean_error'][1]:.6f}) m")
        decision, reason = suggest_decision(rep["radial_rms"],
                                            args.task_tolerance_mm)
        ratio = (rep["radial_rms"] * 1000.0) / args.task_tolerance_mm
        print(f"required_task_tolerance_mm: {args.task_tolerance_mm:.3f}")
        print(f"repeatability_floor / task_tolerance: {ratio:.3f}")
        print(f"Decision (suggested): {decision} — operator confirms")
        print(f"Reason: {reason}")
        return

    if args.mode == "baseline":
        b = analyze_baseline(load_csv(args.csv))
        print(f"laps={b['laps']}  commanded square "
              f"{b['width_cmd'] * 1000.0:.1f} x {b['height_cmd'] * 1000.0:.1f} mm")
        print(f"corner RMS: {b['corner_rms']:.6f} m")
        print(f"closure: {b['closure']:.6f} m")
        print(f"width error: {b['width_error']:.6f} m")
        print(f"height error: {b['height_error']:.6f} m")
        return

    if args.mode == "grid-analysis":
        reps = [load_csv(p) for p in args.csvs]
        res = analyze_grid(reps)
        for nid, n in res["nodes"].items():
            sx, sy = n["systematic_xy"]
            print(f"{nid}: systematic ({sx:.6f}, {sy:.6f}) m  "
                  f"std ({n['std_x']:.6f}, {n['std_y']:.6f}) m  "
                  f"radial std {n['radial_std']:.6f} m  reps={n['reps']}")
        print("Systematic error is the MEAN of repetitions (compensable); "
              "variation is the STD (repeatability floor, not compensable).")
        write_dataset_csv(args.out, res["dataset"])
        return

    if args.mode == "report":
        ident = urdf_identity(args.urdf)
        rep = (analyze_repeatability(load_csv(args.repeatability_csv))
               if args.repeatability_csv else None)
        baseline = (analyze_baseline(load_csv(args.baseline_csv))
                    if args.baseline_csv else None)
        grid = (analyze_grid([load_csv(p) for p in args.grid_csvs])
                if args.grid_csvs else None)
        print(render_feasibility_report(
            robot=ident["robot"], urdf_hash=ident["hash"],
            tcp=ident["tcp_desc"], rep_analysis=rep,
            baseline_analysis=baseline, grid_analysis=grid,
            task_tolerance_mm=args.task_tolerance_mm))
        return


if __name__ == "__main__":
    main()
