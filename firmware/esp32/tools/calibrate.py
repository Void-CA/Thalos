#!/usr/bin/env python3
"""Thalos firmware — servo pulse-range calibration (find the REAL mechanical
endpoints of a servo).

Walks the pulse width of one joint's servo from the centre (1500 us) upward
in small steps, asking the user at every step whether the horn is STILL
MOVING. When the horn stops moving although the pulse keeps growing, you
reached the mechanical end stop -> that pulse is the real maximum. Then it
walks downward from centre to find the real minimum.

The pulse is expressed as the equivalent joint angle (radians) using the
current mapping in servo_config.h, so no firmware changes are needed.

REQUIREMENTS (important):
  - The servo must be DESACOPLADO (not driving the arm / no load).
  - Only that one servo connected to the PCA9685.
  - Watch the horn, not the arm. Answer 'y' while it moves, 'n' when it
    stops (or q to abort the sweep).
  - NEVER keep increasing past the stop: forcing the internal end stop
    damages the gearbox.

Usage:
    python3 tools/calibrate.py --joint 0
    python3 tools/calibrate.py --joint 2 --step-us 50

After measuring, update SERVO_PULSE_MIN_US / SERVO_PULSE_MAX_US for that
channel in firmware/esp32/src/servo_config.h and reflash.
"""
import argparse
import os
import re
import serial
import time
import sys

# ── Lee los valores REALES de servo_config.h (nunca desincronizados) ──────
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "src", "servo_config.h")


def _extract(name, cfg):
    m = re.search(name + r"\[NUM_SERVO_CHANNELS\]\s*=\s*\{(.*?)\}", cfg, re.S)
    if not m:
        raise SystemExit(f"No pude parsear {name} de servo_config.h")
    return [float(x.strip().rstrip("f")) for x in m.group(1).split(",")]


def load_config():
    with open(CONFIG_PATH) as f:
        cfg = f.read()
    return {
        "pulse_min": _extract("SERVO_PULSE_MIN_US", cfg),
        "pulse_max": _extract("SERVO_PULSE_MAX_US", cfg),
        "joint_min": _extract("JOINT_MIN_RAD", cfg),
        "joint_max": _extract("JOINT_MAX_RAD", cfg),
    }


CFG = load_config()


def pulse_to_rad(joint, pulse_us):
    jmin = CFG["joint_min"][joint]
    jmax = CFG["joint_max"][joint]
    pmin = CFG["pulse_min"][joint]
    pmax = CFG["pulse_max"][joint]
    frac = (pulse_us - pmin) / (pmax - pmin)
    return jmin + frac * (jmax - jmin)


def main():
    ap = argparse.ArgumentParser(description="Thalos servo range calibration")
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--joint", type=int, required=True, choices=[0, 1, 2, 3])
    ap.add_argument("--step-us", type=int, default=25,
                    help="pulse step in microseconds (default 25)")
    ap.add_argument("--hold-ms", type=int, default=800,
                    help="pause per step in ms (default 800)")
    args = ap.parse_args()

    print(f"Calibrando joint {args.joint} "
          f"(rad [{CFG['joint_min'][args.joint]}, {CFG['joint_max'][args.joint]}], "
          f"pulso [{CFG['pulse_min'][args.joint]}, {CFG['pulse_max'][args.joint]}] us)")
    print("Observa el BRAZO: y = avanza | n = NO avanza (zumba o no — si no avanza, n)")
    input("Enter para comenzar...")

    ser = serial.Serial(args.port, args.baud, timeout=3)

    def read_line():
        return ser.readline().decode("utf-8", "replace").strip()

    def cmd(line, expect):
        ser.write((line + "\n").encode())
        resp = read_line()
        if expect not in resp:
            print(f"[ERR] {resp!r}")
            sys.exit(1)

    def go_to(pulse_us, label):
        """Mueve el servo a un pulso dado via un manifest de 1 waypoint."""
        rad = pulse_to_rad(args.joint, pulse_us)
        vals = [0.0, 0.0, 0.0, 0.0]
        vals[args.joint] = round(rad, 6)
        cmd("HELLO 1", "OK")
        cmd(f"MANIFEST 4 1 1", "OK")
        cmd("SEGMENT 0 movej 0 1", "OK")
        ser.write(f"SAMPLE {vals[0]:.6f} {vals[1]:.6f} {vals[2]:.6f} {vals[3]:.6f} 0\n".encode())
        read_line()
        cmd("END_UPLOAD", "READY")
        cmd("EXECUTE", "OK")
        time.sleep(0.8)
        print(f"  {label}: {pulse_us} us (rad {rad:.4f})")

    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(1.2)
    ser.reset_input_buffer()

    # Subir desde el centro hasta el tope.
    go_to(1500, "centro")
    max_us = 1500
    while True:
        pulse = max_us + args.step_us
        go_to(pulse, "subiendo")
        ans = input("    - se sigue moviendo? [y/n/q] ").strip().lower()
        if ans == "q":
            sys.exit(0)
        if ans == "n":
            max_us = pulse - args.step_us  # el ultimo que SI se movio
            break
        max_us = pulse

    # Bajar desde el centro hasta el tope inferior.
    go_to(1500, "centro")
    min_us = 1500
    while True:
        pulse = min_us - args.step_us
        go_to(pulse, "bajando")
        ans = input("    - se sigue moviendo? [y/n/q] ").strip().lower()
        if ans == "q":
            sys.exit(0)
        if ans == "n":
            min_us = pulse + args.step_us
            break
        min_us = pulse

    print(f"\n=== RESULTADO joint {args.joint} ===")
    print(f"  PULSE_MIN_US = {min_us}")
    print(f"  PULSE_MAX_US = {max_us}")
    print(f"  Rango de pulso util: {max_us - min_us} us")
    print("  Actualiza servo_config.h y re-flashea.")
    ser.close()

if __name__ == "__main__":
    main()
