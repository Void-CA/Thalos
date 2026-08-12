#!/usr/bin/env python3
"""Thalos — calibration acquisition driver (Calibration Feasibility experiment).

Acquires the commanded XY grid for the calibration experiment and emits CSV
templates that a human fills with ruler/caliper measurements. This script
NEVER claims to know the real position (no encoders): the `measured_*` columns
are filled by hand, always.

Modes (Phases 1-3 of the calibration-field change):

    repeatability   Move ONE reference point N times (default 10), emit a
                    CSV template with N rows of the same commanded XY.
    square          Draw an 80x80 mm square (default) twice around a reachable
                    center point; emit corner + closure CSV template rows.
    grid            Execute a 3x3 grid (NINE nodes, not 5x5 yet) and emit the
                    9-node CSV template. Repeat the grid 2-3 times; the
                    analysis separates systematic error (mean of repetitions)
                    from variation (std) per node.
    targets         (offline) Write the 3x3 grid or square target JSON with
                    commanded XY filled and joints empty.

The firmware only consumes JOINT angles (4 values per SAMPLE), so every mode
needs the joint configuration that places the TCP at each commanded XY. Solve
IK with the backend first (POST /api/v1/scene/from-fk or the UI) and provide
the joints in the targets JSON (`targets:` entries, filled by the operator) or
inline via --joints for the single-point modes. The protocol is the SAME as
move_joint.py / calibrate.py: HELLO -> MANIFEST -> SEGMENT -> SAMPLE ->
END_UPLOAD -> EXECUTE. No new protocol is invented here.

Requires pyserial only when executing on hardware (--port given); the pure
logic (grid/CSV/validation) is importable and unit-testable without it.

Usage:
    # Phase 1 - repeatability (one reference point, 10x)
    python3 tools/calibration_driver.py repeatability \
        --port /dev/ttyUSB0 \
        --point-xy 0.30 0.10 --joints 0.0 0.8 1.2 0.04 \
        --repetitions 10 --out measurements/repeatability.csv

    # Phase 2 - baseline square (80x80 mm, twice)
    python3 tools/calibration_driver.py square \
        --port /dev/ttyUSB0 --size-m 0.08 --center-xy 0.30 0.10 \
        --joints "0.0 0.8 1.2 0.04|0.1 0.7 1.3 0.04|0.2 0.6 1.4 0.04|0.1 0.9 1.1 0.04" \
        --laps 2 --out measurements/baseline_square.csv

    # Phase 3 - grid: first generate the target JSON, fill joints after IK
    python3 tools/calibration_driver.py targets --grid --out targets/grid_3x3.json
    # ... operator solves IK for each node and fills "joints" in the JSON ...
    python3 tools/calibration_driver.py grid \
        --port /dev/ttyUSB0 --targets targets/grid_3x3.json \
        --out measurements/grid_rep1.csv

Safety: hold the arm on the first EXECUTE (first waypoint may jump to the
servo neutral). Use external servo power with common GND (see tools/README.md).
"""
import argparse
import json
import math
import os
import sys

# CSV contract (must match calibration_analysis.py):
#   node_id | commanded_x_m | commanded_y_m | measured_x_m | measured_y_m
# commanded: exactly 6 decimals, meters. measured: empty in the template.
CSV_COLUMNS = ["node_id", "commanded_x_m", "commanded_y_m",
               "measured_x_m", "measured_y_m"]


# ── Pure geometry / generation (unit-testable, no hardware) ───────────────

def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def generate_grid(rows=3, cols=3, width_m=0.08, height_m=0.08,
                  center_xy=(0.30, 0.10)):
    """NxM grid in the work plane (default 3x3 = NINE nodes, NOT 5x5 yet).

    Raster order: top row -> bottom row, left to right within a row.
    Returns a list of (x, y) commanded points in meters.
    """
    cx, cy = center_xy
    sx = width_m / (cols - 1) if cols > 1 else 0.0
    sy = height_m / (rows - 1) if rows > 1 else 0.0
    nodes = []
    for r in range(rows):
        y = cy + height_m / 2.0 - r * sy
        for c in range(cols):
            x = cx - width_m / 2.0 + c * sx
            nodes.append((x, y))
    return nodes


def make_grid_targets(rows=3, cols=3, width_m=0.08, height_m=0.08,
                      center_xy=(0.30, 0.10)):
    """Target JSON entries for the grid: commanded XY filled, joints EMPTY."""
    return [
        {"id": f"n{i}", "commanded_xy_m": [x, y], "joints": None}
        for i, (x, y) in enumerate(generate_grid(rows, cols, width_m, height_m,
                                                 center_xy))
    ]


def square_waypoints(size_m=0.08, center_xy=(0.30, 0.10)):
    """Four corners of a square centered in a reachable zone (meters)."""
    cx, cy = center_xy
    h = size_m / 2.0
    return [(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h), (cx - h, cy + h)]


def make_square_targets(size_m=0.08, center_xy=(0.30, 0.10)):
    """Target JSON entries for the square: c0..c3, joints EMPTY."""
    return [
        {"id": f"c{i}", "commanded_xy_m": list(xy), "joints": None}
        for i, xy in enumerate(square_waypoints(size_m, center_xy))
    ]


# ── CSV template / serialization (pure) ───────────────────────────────────

def _fmt6(v):
    """Format a meter value with exactly 6 decimals."""
    return f"{v:.6f}"


def csv_rows_from_targets(targets):
    """Convert target entries (commanded filled, measured None) to CSV rows."""
    return [
        {"node_id": t["id"],
         "commanded_xy_m": t["commanded_xy_m"],
         "measured_xy_m": None}
        for t in targets
    ]


def repeatability_rows(commanded_xy, repetitions=10):
    """Phase 1: N rows of the SAME commanded reference point, measured empty."""
    return [
        {"node_id": "ref",
         "commanded_xy_m": list(commanded_xy),
         "measured_xy_m": None}
        for _ in range(repetitions)
    ]


def square_rows(size_m=0.08, center_xy=(0.30, 0.10), laps=2):
    """Phase 2: per lap the 4 corners plus a closure row (commanded = c0)."""
    corners = square_waypoints(size_m, center_xy)
    rows = []
    for _ in range(laps):
        for i, xy in enumerate(corners):
            rows.append({"node_id": f"c{i}", "commanded_xy_m": list(xy),
                         "measured_xy_m": None})
        rows.append({"node_id": "closure", "commanded_xy_m": list(corners[0]),
                     "measured_xy_m": None})
    return rows


def csv_template(rows):
    """Serialize CSV rows to text: commanded 6 decimals, measured empty/6 dec."""
    lines = [",".join(CSV_COLUMNS)]
    for r in rows:
        cx, cy = r["commanded_xy_m"]
        m = r.get("measured_xy_m")
        mx = _fmt6(m[0]) if m is not None else ""
        my = _fmt6(m[1]) if m is not None else ""
        lines.append(f"{r['node_id']},{_fmt6(cx)},{_fmt6(cy)},{mx},{my}")
    return "\n".join(lines) + "\n"


def write_csv_template(path, rows):
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(csv_template(rows))


def parse_csv_text(text):
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
        measured = [fields[3], fields[4]]
        if measured == ["", ""]:
            row["measured_x_m"] = None
            row["measured_y_m"] = None
            row["measured_xy_m"] = None
        else:
            try:
                row["measured_x_m"] = float(fields[3])
                row["measured_y_m"] = float(fields[4])
            except ValueError:
                raise ValueError(f"row {i}: measured must be numeric or empty: "
                                 f"{line!r}")
            row["measured_xy_m"] = [row["measured_x_m"], row["measured_y_m"]]
        rows.append(row)
    return rows


def validate_csv_text(text):
    """Return a list of schema problems; empty list means valid.

    Enforces: exact header, 5 fields per row, non-empty node_id, commanded
    numeric with EXACTLY 6 decimals (meters), measured empty or numeric.
    """
    errors = []
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return ["CSV is empty"]
    header = lines[0].split(",")
    for col in CSV_COLUMNS:
        if col not in header:
            errors.append(f"missing column {col!r} (units _m required)")
    for i, line in enumerate(lines[1:], start=2):
        fields = line.split(",")
        if len(fields) != len(CSV_COLUMNS):
            errors.append(f"row {i}: expected {len(CSV_COLUMNS)} fields, "
                          f"got {len(fields)}")
            continue
        if not fields[0]:
            errors.append(f"row {i}: empty node_id")
        for name, idx in (("commanded_x_m", 1), ("commanded_y_m", 2)):
            v = fields[idx]
            try:
                float(v)
            except ValueError:
                errors.append(f"row {i}: {name} not numeric: {v!r}")
                continue
            if len(v.split(".")[-1]) != 6:
                errors.append(f"row {i}: {name} must have exactly 6 decimal "
                              f"places: {v!r}")
        for name, idx in (("measured_x_m", 3), ("measured_y_m", 4)):
            v = fields[idx]
            if v != "":
                try:
                    float(v)
                except ValueError:
                    errors.append(f"row {i}: {name} not numeric: {v!r}")
    return errors


# ── Serial protocol (move_joint.py pattern; pyserial only at runtime) ─────

def build_move_manifest(joints, dt_us=0):
    """Message list for ONE single-waypoint move (move_joint.py/calibrate.py).

    Returns the exact lines: HELLO -> MANIFEST -> SEGMENT -> SAMPLE ->
    END_UPLOAD -> EXECUTE. Joint values formatted with 4 decimals, same as
    move_joint.py. dt_us is the time to the NEXT waypoint; with a single
    waypoint the SAMPLE dt is 0 (first sample rule). The MANIFEST duration
    MUST be >= 1 us: the firmware rejects dur == 0 with INVALID_MANIFEST
    (firmware/esp32/src/protocol.cpp:90) — hence max(dt_us, 1).
    """
    return [
        "HELLO 1",
        f"MANIFEST 4 1 {max(dt_us, 1)}",
        "SEGMENT 0 movej 0 1",
        f"SAMPLE {joints[0]:.4f} {joints[1]:.4f} {joints[2]:.4f} "
        f"{joints[3]:.4f} {dt_us}",
        "END_UPLOAD",
        "EXECUTE",
    ]


def execute_target(port, baud, joints, dwell_s=1.0):
    """Move the robot to ONE joint configuration via serial (blocking).

    Returns True on success (EXECUTE acked + STATUS COMPLETED). Reuses the
    handshake/reset and command/response pattern of move_joint.py exactly.
    """
    import serial
    import time

    ser = serial.Serial(port, baud, timeout=3)

    def read_line():
        return ser.readline().decode("utf-8", "replace").strip()

    def cmd(line, expect, label):
        ser.write((line + "\n").encode())
        resp = read_line()
        ok = expect in resp
        print(f"[{'OK ' if ok else 'ERR'}] {label}: {resp!r}")
        return ok

    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(1.2)
    ser.reset_input_buffer()

    msgs = build_move_manifest(joints)
    ok = True
    ok &= cmd(msgs[0], "OK", "handshake")
    ok &= cmd(msgs[1], "OK", "manifest")
    ok &= cmd(msgs[2], "OK", "segment")
    ser.write((msgs[3] + "\n").encode())
    if "OK" not in read_line():
        print("[ERR] sample rejected")
        ok = False
    ok &= cmd(msgs[4], "READY", "end_upload")
    if ok:
        try:
            cmd(msgs[5], "OK", "EXECUTE")
            time.sleep(dwell_s)
            cmd("STATUS", "COMPLETED", "completado")
        except KeyboardInterrupt:
            print("\n[STOP] aborted by user")
            ser.write(b"STOP\n")
            read_line()
            ok = False
    ser.close()
    return ok


# ── CLI ───────────────────────────────────────────────────────────────────

def _parse_joints_list(text):
    """Parse 'j0 j1 j2 j3|j0 j1 j2 j3' -> list of 4-joint lists."""
    groups = [g.strip() for g in text.split("|") if g.strip()]
    out = []
    for g in groups:
        vals = [float(v) for v in g.split()]
        if len(vals) != 4:
            raise SystemExit(f"each joint group needs 4 values, got {vals!r}")
        out.append(vals)
    return out


def _write_targets_json(path, entries):
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)
        f.write("\n")
    print(f"[OK ] targets written: {path} (fill 'joints' after solving IK)")


def _load_targets_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _entry_for_id(entries, node_id):
    for e in entries:
        if e["id"] == node_id:
            return e
    raise SystemExit(f"no target with id {node_id!r} in targets file")


def _run_target_sequence(port, baud, entries, dwell_s, out_path):
    """Execute every target in order and emit a CSV template of the commanded XY."""
    rows = []
    for e in entries:
        if port:
            if not e.get("joints"):
                raise SystemExit(f"target {e['id']!r} has no joints — solve IK "
                                 "first (POST /api/v1/scene/from-fk or UI)")
            ok = execute_target(port, baud, e["joints"], dwell_s=dwell_s)
            if not ok:
                raise SystemExit(f"target {e['id']!r} FAILED on hardware")
        rows.append({"node_id": e["id"], "commanded_xy_m": e["commanded_xy_m"],
                     "measured_xy_m": None})
        cx, cy = e["commanded_xy_m"]
        print(f"[OK ] target {e['id']!r} commanded ({cx:.6f}, {cy:.6f}) m")
    write_csv_template(out_path, rows)
    print(f"[OK ] CSV template: {out_path} (fill measured_*_m by hand)")
    return rows


def main():
    port_args = argparse.ArgumentParser(add_help=False)
    port_args.add_argument("--port", default="/dev/ttyUSB0",
                           help="serial port; pass 'none' for offline template "
                                "only")
    port_args.add_argument("--baud", type=int, default=115200)
    port_args.add_argument("--dwell-s", type=float, default=1.0,
                           help="pause per move in seconds (default 1.0)")

    ap = argparse.ArgumentParser(
        description="Thalos calibration acquisition driver (Phases 1-3)",
        parents=[port_args])
    sub = ap.add_subparsers(dest="mode", required=True)

    p_rep = sub.add_parser("repeatability",
                           help="Phase 1: N x one reference point",
                           parents=[port_args])
    p_rep.add_argument("--point-xy", nargs=2, type=float, required=True,
                       metavar=("X", "Y"))
    p_rep.add_argument("--joints", nargs=4, type=float, required=True,
                       metavar=("J0", "J1", "J2", "J3"),
                       help="joint angles reaching the point (solve IK first)")
    p_rep.add_argument("--repetitions", type=int, default=10)
    p_rep.add_argument("--out", default="measurements/repeatability.csv")

    p_sq = sub.add_parser("square", help="Phase 2: draw a square twice",
                          parents=[port_args])
    p_sq.add_argument("--size-m", type=float, default=0.08)
    p_sq.add_argument("--center-xy", nargs=2, type=float, default=[0.30, 0.10],
                      metavar=("X", "Y"))
    p_sq.add_argument("--joints", required=True,
                      help="4 joint groups c0|c1|c2|c3 (solve IK first)")
    p_sq.add_argument("--laps", type=int, default=2)
    p_sq.add_argument("--out", default="measurements/baseline_square.csv")

    p_gr = sub.add_parser("grid", help="Phase 3: execute a 3x3 grid",
                          parents=[port_args])
    p_gr.add_argument("--targets", required=True,
                      help="targets JSON (generate with 'targets --grid')")
    p_gr.add_argument("--out", default="measurements/grid_rep1.csv")
    p_gr.add_argument("--repeat", type=int, default=1,
                      help="repeat the whole grid N times into separate files "
                           "(suffix _repK)")

    p_tg = sub.add_parser("targets", help="offline: write target JSON templates")
    p_tg.add_argument("--grid", action="store_true",
                      help="write a 3x3 grid targets JSON (NINE nodes)")
    p_tg.add_argument("--square", action="store_true",
                      help="write a square corners targets JSON")
    p_tg.add_argument("--rows", type=int, default=3)
    p_tg.add_argument("--cols", type=int, default=3)
    p_tg.add_argument("--width-m", type=float, default=0.08)
    p_tg.add_argument("--height-m", type=float, default=0.08)
    p_tg.add_argument("--center-xy", nargs=2, type=float, default=[0.30, 0.10],
                      metavar=("X", "Y"))
    p_tg.add_argument("--out", required=True)

    args = ap.parse_args()
    port = None if args.port == "none" else args.port

    if args.mode == "targets":
        if args.grid == args.square:
            raise SystemExit("choose exactly one of --grid or --square")
        entries = (make_grid_targets(args.rows, args.cols, args.width_m,
                                     args.height_m, tuple(args.center_xy))
                   if args.grid else make_square_targets(args.width_m,
                                                         tuple(args.center_xy)))
        _write_targets_json(args.out, entries)
        return

    if args.mode == "repeatability":
        joints = [args.joints]
        for i in range(args.repetitions):
            if port:
                if not execute_target(port, args.baud, joints[0],
                                      dwell_s=args.dwell_s):
                    raise SystemExit(f"repetition {i + 1} FAILED on hardware")
            print(f"[OK ] repetition {i + 1}/{args.repetitions}")
        rows = repeatability_rows(tuple(args.point_xy), args.repetitions)
        write_csv_template(args.out, rows)
        print(f"[OK ] CSV template: {args.out} "
              f"(measure each landing with the ruler and fill measured_*_m)")
        return

    if args.mode == "square":
        joints = _parse_joints_list(args.joints)
        if len(joints) != 4:
            raise SystemExit("--joints needs exactly 4 groups (c0|c1|c2|c3)")
        entries = make_square_targets(args.size_m, tuple(args.center_xy))
        for e, j in zip(entries, joints):
            e["joints"] = j
        laps = args.laps
        seq = []
        for _ in range(laps):
            seq.extend(entries)
            seq.append({"id": "closure", "commanded_xy_m": entries[0]["commanded_xy_m"],
                        "joints": entries[0]["joints"]})
        rows = _run_target_sequence(port, args.baud, seq, args.dwell_s, args.out)
        print(f"[OK ] square drawn {laps}x — measure the 4 corners AND the "
              f"closure gap, fill measured_*_m in {args.out}")
        return

    if args.mode == "grid":
        entries = _load_targets_json(args.targets)
        if len(entries) != 9:
            print(f"[WARN] grid has {len(entries)} nodes (expect 9 for the "
                  f"3x3 Phase 3 grid)")
        for rep in range(args.repeat):
            suffix = "" if args.repeat == 1 else f"_rep{rep + 1}"
            out = args.out.replace(".csv", f"{suffix}.csv")
            _run_target_sequence(port, args.baud, entries, args.dwell_s, out)
        print("[OK ] grid done — repeat the whole grid 2-3 times, then run "
              "calibration_analysis.py grid-analysis to separate systematic "
              "error (mean per node) from variation (std per node)")


if __name__ == "__main__":
    main()
