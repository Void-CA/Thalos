#!/usr/bin/env python3
"""Thalos firmware — servo pulse-range calibration (find the REAL mechanical
endpoints of a servo).

Walks the pulse width of one joint's servo from the centre (1500 us) upward
in small steps, asking the user at every step whether the horn is STILL
MOVING. When the horn stops moving although the pulse keeps growing, you
reached the mechanical end stop -> that pulse is the real maximum. Then it
walks downward from centre to find the real minimum.

The pulse is expressed as the equivalent joint angle (radians) using the
current mapping in the canonical ``config/safety-envelope.toml`` (single
source of truth — spec safety-envelope-canonical-source), so no firmware
changes are needed.

After measuring, the tool writes the measured pulse range BACK to the TOML
via ``safety_config`` (one field at a time, old/new shown first — the 7-step
calibration flow, see docs/calibration.md), then prints the regeneration and
parity commands. ``write_pulse_range`` is a pure function (no serial / no
hardware) so it is unit-testable independently.

REQUIREMENTS (important):
  - The servo must be DESACOPLADO (not driving the arm / no load).
  - Only that one servo connected to the PCA9685.
  - Watch the horn, not the arm. Answer 'y' while it moves, 'n' when it
    stops (or q to abort the sweep).
  - NEVER keep increasing past the stop: forcing the internal end stop
    damages the gearbox.

Usage:
    python3 firmware/esp32/tools/calibrate.py --joint 0
    python3 firmware/esp32/tools/calibrate.py --joint 2 --step-us 50
"""
import argparse
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "tools"))
import safety_config  # noqa: E402

# ── Lee los valores REALES de config/safety-envelope.toml (la única fuente) ─
def _load_config():
    data = safety_config.load()
    channels = sorted(data["channel"], key=lambda ch: ch["index"])
    return {
        "pulse_min": [ch["pulse"]["min_us"] for ch in channels],
        "pulse_max": [ch["pulse"]["max_us"] for ch in channels],
        "joint_min": [ch["calibration"]["joint_min_rad"] for ch in channels],
        "joint_max": [ch["calibration"]["joint_max_rad"] for ch in channels],
    }


CFG = _load_config()


def pulse_to_rad(joint, pulse_us):
    jmin = CFG["joint_min"][joint]
    jmax = CFG["joint_max"][joint]
    pmin = CFG["pulse_min"][joint]
    pmax = CFG["pulse_max"][joint]
    frac = (pulse_us - pmin) / (pmax - pmin)
    return jmin + frac * (jmax - jmin)


def write_pulse_range(channel_index, min_us, max_us, toml_path=None):
    """Write the measured pulse range for ONE channel back to the TOML.

    Pure (no serial / no hardware): the candidate values are injected, so CI
    can exercise the write-back without a robot. Shows old/new for each field
    (flow step 3), writes ONLY the two pulse fields of that channel (flow
    step 4), then prints the regeneration + parity commands (steps 6-7).
    """
    path = toml_path or safety_config.DEFAULT_TOML
    old_min = safety_config.get_field(channel_index, "pulse", "min_us", path)
    old_max = safety_config.get_field(channel_index, "pulse", "max_us", path)
    safety_config.show_old_new(channel_index, "pulse", "min_us", old_min, min_us)
    safety_config.update_channel_field(
        channel_index, "pulse", "min_us", min_us, toml_path=path
    )
    safety_config.show_old_new(channel_index, "pulse", "max_us", old_max, max_us)
    safety_config.update_channel_field(
        channel_index, "pulse", "max_us", max_us, toml_path=path
    )
    print("  Escrito en config/safety-envelope.toml. Proximos pasos:")
    print("    python3 tools/generate_safety_config.py")
    print("    python3 tools/check_safety_parity.py")


def main():
    import serial
    import time

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
    write_pulse_range(args.joint, min_us, max_us)
    ser.close()


if __name__ == "__main__":
    main()
