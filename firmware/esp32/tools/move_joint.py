#!/usr/bin/env python3
"""Thalos firmware — move a single joint (servo) with a generated plan.

Uploads a manifest that moves ONE joint through a symmetric sweep around 0
while the other joints stay at 0 (their neutral). Only the servo physically
connected to that joint's channel will respond (isolation: connect just one
servo at a time).

Channel map (firmware/esp32/src/servo_config.h):
    joint 0 (base)     -> channel 15
    joint 1 (codo)     -> channel 14
    joint 2 (muneca)   -> channel 13
    joint 3 (prism.)   -> channel 11   (CAREFUL: ultra-sensitive mapping)

Usage:
    python3 tools/move_joint.py --joint 0 --range 0.2 --dt-ms 1000
    python3 tools/move_joint.py --joint 1 --range 0.15 --dt-ms 100 --step 0.02

Safety:
  - The FIRST waypoint may jump to the servo's neutral (0 rad). Hold the arm.
  - Use a SMALL --range for the first test of any joint.
  - The prismatic joint (3) has a very sensitive mapping (0.06 rad = full
    sweep). For it, use --range 0.005 and calibrate first (tools/calibrate.py).
  - Stop is Ctrl+C: the script leaves the servo in hold-last-position.
"""
import argparse
import serial
import time
import sys

def build_plan(pk):
    """0 -> +max -> 0 -> min -> 0 (asymmetric sweep; max/min may be 0)."""
    joints = []
    v = 0.0
    while v < pk.max_val:
        joints.append(round(v, 4))
        v += pk.step
    while v > pk.min_val:
        joints.append(round(v, 4))
        v -= pk.step
    while v < 0.0:
        joints.append(round(v, 4))
        v += pk.step
    joints.append(0.0)
    return joints

def main():
    ap = argparse.ArgumentParser(description="Thalos move single joint")
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--joint", type=int, required=True, choices=[0, 1, 2, 3])
    ap.add_argument("--range", type=float, default=0.15,
                    help="peak sweep in radians (default 0.15)")
    ap.add_argument("--min", type=float, default=None,
                    help="asymmetric sweep lower bound (rad); overrides --range on the negative side")
    ap.add_argument("--max", type=float, default=None,
                    help="asymmetric sweep upper bound (rad); overrides --range on the positive side")
    ap.add_argument("--step", type=float, default=0.02,
                    help="increment between waypoints in radians (default 0.02)")
    ap.add_argument("--dt-ms", type=int, default=1000,
                    help="time between waypoints in ms (default 1000)")
    args = ap.parse_args()

    # Asymmetric sweep: explicit min/max override --range (default symmetric).
    args.max_val = args.max if args.max is not None else args.range
    args.min_val = args.min if args.min is not None else -args.range

    if args.joint == 3 and (args.max_val > 0.01 or args.min_val < -0.01):
        print("[AVISO] joint 3 (prismatico): mapeo ultra-sensible, "
              "use rangos <= 0.005 y calibre primero con calibrate.py")
        sys.exit(1)

    dt_us = args.dt_ms * 1000
    plan = build_plan(args)
    n = len(plan)

    print(f"Joint {args.joint}: {n} waypoints, paso {args.step} rad, "
          f"dt {args.dt_ms} ms, rango [{args.min_val}, {args.max_val}] rad")
    print(f"  Trajectory: 0 -> +{args.max_val} -> 0 -> {args.min_val} -> 0")
    print("  SOSTENE EL BRAZO. Primer waypoint puede saltar al neutro.")
    input("  Enter para subir el plan (EXECUTE) o Ctrl+C para abortar...")

    ser = serial.Serial(args.port, args.baud, timeout=3)

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

    ok = True
    ok &= cmd("HELLO 1", "HELLO 1 OK", "handshake")
    ok &= cmd(f"MANIFEST 4 {n} {(n - 1) * dt_us}", "OK", "manifest")
    ok &= cmd(f"SEGMENT 0 movej 0 {n}", "OK", "segment")
    for i, j in enumerate(plan):
        vals = [0.0, 0.0, 0.0, 0.0]
        vals[args.joint] = j
        dt = 0 if i == 0 else dt_us
        ser.write(f"SAMPLE {vals[0]:.4f} {vals[1]:.4f} {vals[2]:.4f} {vals[3]:.4f} {dt}\n".encode())
        if "OK" not in read_line():
            print(f"[ERR] sample {i}")
            ok = False
            break
    print(f"[OK ] samples {n} enviados")
    ok &= cmd("END_UPLOAD", "READY", "end_upload")
    if ok:
        print("  Moviendo... (Ctrl+C detiene la escritura, el servo queda en hold)")
        try:
            cmd("EXECUTE", "OK", "EXECUTE")
            time.sleep(n * args.dt_ms / 1000.0 + 0.5)
            cmd("STATUS", "COMPLETED", "completado")
        except KeyboardInterrupt:
            print("\n[STOP] abortado por usuario")
            ser.write(b"STOP\n")
            read_line()
    ser.close()

if __name__ == "__main__":
    main()
