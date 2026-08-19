#!/usr/bin/env python3
"""Thalos firmware — servo pulse-range calibration (3-phase discovery).

Finds the REAL mechanical endpoints of a servo through three distinct phases:

  1. DISCOVERY — sweep from centre outward using THEORETICAL range as limits
     (independent of TOML history). User confirms whether the servo moves
     proportionally at each step.

  2. VALIDATION — walk the discovered range to confirm smooth proportional
     response. Identifies dead zones, buzzing regions, and non-linear spots.

  3. WRITE — only the confirmed range is written to the TOML.

KEY DESIGN PRINCIPLE: the exploration range is NEVER derived from the TOML's
historical calibration values. Previous bad calibrations must not constrain
future discovery. The theoretical range is per-actuator-type and conservative.

The pulse is commanded DIRECTLY to the PCA9685 through the firmware's
calibration-only ``RAW_PULSE <channel> <us>`` command — NO radian round-trip
and NO envelope wall.

Requires firmware built from the current source (RAW_PULSE support):
    cd firmware/esp32 && pio run -t upload

REQUIREMENTS:
  - The servo must be DESACOPLADO (not driving the arm / no load).
  - Only that one servo connected to the PCA9685.
  - Watch the horn, not the arm.
  - NEVER keep increasing past the stop: forcing the internal end stop
    damages the gearbox.

Usage:
    python3 firmware/esp32/tools/calibrate.py --joint 0
    python3 firmware/esp32/tools/calibrate.py --joint 2 --step-us 50
    python3 firmware/esp32/tools/calibrate.py --joint 3 --skip-validation
"""
import argparse
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "tools"))
import safety_config  # noqa: E402

# ── Theoretical range per actuator type ────────────────────────────────────
# These are CONSERVATIVE theoretical limits for MG90S-class servos.
# They are NEVER derived from TOML history. A previous bad calibration
# must not constrain future discovery.
#
# Revolute (base, elbow, wrist): standard RC servo range
# Prismatic: narrower by default — hard mechanical stops on the lead screw.
THEORETICAL_RANGES = {
    "revolute":  {"explore_min": 1000, "explore_max": 2000, "floor": 500,  "ceil": 2500},
    "prismatic": {"explore_min": 1000, "explore_max": 2000, "floor": 500,  "ceil": 2500},
}

# Joint index → actuator type
JOINT_TYPES = {
    0: "revolute",   # base
    1: "revolute",   # elbow
    2: "revolute",   # wrist
    3: "prismatic",  # prismatic (lead screw)
}


def _load_config():
    """Load TOML config. Used ONLY for display and write-back, NEVER for
    exploration limits."""
    data = safety_config.load()
    channels = sorted(data["channel"], key=lambda ch: ch["index"])
    return {
        "pulse_min": [ch["pulse"]["min_us"] for ch in channels],
        "pulse_max": [ch["pulse"]["max_us"] for ch in channels],
        "joint_min": [ch["calibration"]["joint_min_rad"] for ch in channels],
        "joint_max": [ch["calibration"]["joint_max_rad"] for ch in channels],
        "servo_channels": data["hardware"]["servo_channels"],
    }


CFG = _load_config()


def write_pulse_range(channel_index, min_us, max_us, toml_path=None):
    """Write the measured pulse range for ONE channel back to the TOML.

    Pure (no serial / no hardware): the candidate values are injected, so CI
    can exercise the write-back without a robot. Shows old/new for each field
    (flow step 3), writes ONLY the two pulse fields of that channel (flow
    step 4), then prints the regeneration + parity commands (steps 6-7).

    Physical sanity gate: a servo pulse width must be positive and within the
    RC-servo envelope. A measured range that violates this (e.g. a negative
    min from an unbounded sweep) is a measurement error — refuse to write it
    instead of corrupting the canonical config.
    """
    PULSE_FLOOR_US = 300
    PULSE_CEIL_US = 2600

    if not (PULSE_FLOOR_US <= min_us < max_us <= PULSE_CEIL_US):
        raise ValueError(
            f"invalid measured pulse range [{min_us}, {max_us}] us — "
            f"must satisfy {PULSE_FLOOR_US} <= min < max <= {PULSE_CEIL_US}; "
            f"redo the sweep (a servo pulse cannot be negative or unbounded)"
        )
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


def _get_theoretical_range(joint_index):
    """Return (explore_min, explore_max, floor, ceil) for this joint.

    These are per-actuator-type theoretical limits. NEVER reads from TOML
    historical calibration — a previous bad calibration must not constrain
    future discovery.
    """
    joint_type = JOINT_TYPES.get(joint_index, "revolute")
    return THEORETICAL_RANGES[joint_type]


def _connect(port, baud):
    """Connect to the ESP32 and reset the serial buffer."""
    import serial
    import time

    ser = serial.Serial(port, baud, timeout=3)
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(1.2)
    ser.reset_input_buffer()
    return ser


def _read_line(ser):
    return ser.readline().decode("utf-8", "replace").strip()


def _go_to(ser, channel, pulse_us, label, hold_ms=800):
    """Send RAW_PULSE to the servo and wait."""
    import time

    ser.write(f"RAW_PULSE {channel} {pulse_us}\n".encode())
    resp = _read_line(ser)
    if "OK" not in resp:
        print(f"[ERR] RAW_PULSE fallo: {resp!r}")
        print("  El firmware flasheado no soporta RAW_PULSE — reflashealo:")
        print("    cd firmware/esp32 && pio run -t upload")
        sys.exit(1)
    time.sleep(hold_ms / 1000.0)
    print(f"  {label}: {pulse_us} us (canal {channel})")


def _phase_discovery(ser, channel, step_us, explore_min, explore_max):
    """Phase 1: DISCOVERY — sweep from centre outward to find mechanical limits.

    Returns (discovered_min, discovered_max) in microseconds.
    The sweep uses THEORETICAL limits, not TOML history.
    """
    print("\n── FASE 1: DISCOVERY ──")
    print(f"  Rango de exploracion: {explore_min}–{explore_max} us (teorico)")
    print("  Observa el SERVO: y = se mueve proporcionalmente | n = ya no se mueve")
    print("                    s = zumba/vibra sin mover | q = abortar")

    # Start at centre
    _go_to(ser, channel, 1500, "centro")

    # ── Sweep UP ──
    max_us = 1500
    while True:
        pulse = max_us + step_us
        if pulse > explore_max:
            if pulse - step_us < explore_max:
                # Close to limit, try the exact limit
                pulse = explore_max
            else:
                print(f"  [INFO] tope de exploracion alcanzado ({explore_max} us)")
                max_us = explore_max
                break
        _go_to(ser, channel, pulse, "subiendo")
        ans = input("    - estado? [y/n/s/q] ").strip().lower()
        if ans == "q":
            sys.exit(0)
        if ans == "s":
            print("  ⚠ Zumba/vibra — parando el sweep ascendente")
            max_us = pulse - step_us
            break
        if ans == "n":
            max_us = pulse - step_us
            break
        max_us = pulse

    # Return to centre before going down
    _go_to(ser, channel, 1500, "centro")

    # ── Sweep DOWN ──
    min_us = 1500
    while True:
        pulse = min_us - step_us
        if pulse < explore_min:
            if pulse + step_us > explore_min:
                pulse = explore_min
            else:
                print(f"  [INFO] tope de exploracion alcanzado ({explore_min} us)")
                min_us = explore_min
                break
        _go_to(ser, channel, pulse, "bajando")
        ans = input("    - estado? [y/n/s/q] ").strip().lower()
        if ans == "q":
            sys.exit(0)
        if ans == "s":
            print("  ⚠ Zumba/vibra — parando el sweep descendente")
            min_us = pulse + step_us
            break
        if ans == "n":
            min_us = pulse + step_us
            break
        min_us = pulse

    return min_us, max_us


def _phase_validation(ser, channel, discovered_min, discovered_max, step_us):
    """Phase 2: VALIDATION — walk the discovered range to confirm smooth response.

    Returns the validated (min, max). If any step fails validation, the user
    can narrow the range.
    """
    print("\n── FASE 2: VALIDACION ──")
    print(f"  Rango descubierto: {discovered_min}–{discovered_max} us")
    print("  Verificando respuesta proporcional en cada paso...")
    print("  y = OK | n = problema en este punto | q = abortar")

    # Test a few points: centre, quarter, three-quarter
    test_points = [
        discovered_min,
        discovered_min + (discovered_max - discovered_min) // 4,
        (discovered_min + discovered_max) // 2,
        discovered_min + 3 * (discovered_max - discovered_min) // 4,
        discovered_max,
    ]
    # Deduplicate
    test_points = sorted(set(test_points))

    problems = []
    for pulse in test_points:
        _go_to(ser, channel, pulse, f"verificando {pulse}us", hold_ms=600)
        ans = input("    - respuesta OK? [y/n/q] ").strip().lower()
        if ans == "q":
            sys.exit(0)
        if ans == "n":
            problems.append(pulse)

    if not problems:
        print("  ✓ Todos los puntos responden proporcionalmente")
        return discovered_min, discovered_max

    print(f"\n  Problemas detectados en: {problems} us")
    print("  Opciones:")
    print("    1. Reducir el rango (ignorar los puntos problemáticos)")
    print("    2. Mantener el rango (aceitar la no-linearidad)")
    choice = input("  Tu eleccion [1/2]: ").strip()
    if choice == "1":
        # Filter out problem points and take the largest contiguous range
        good = [p for p in test_points if p not in problems]
        if len(good) < 2:
            print("  [ERR] Muy puntos validos — recalibrar con otro paso")
            return discovered_min, discovered_max
        # Take min/max of good points
        return good[0], good[-1]

    return discovered_min, discovered_max


def main():
    ap = argparse.ArgumentParser(
        description="Thalos servo calibration — 3-phase discovery",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Phases:
  1. Discovery  — sweep from centre using theoretical range (NOT TOML history)
  2. Validation — confirm proportional response across discovered range
  3. Write      — save confirmed range to safety-envelope.toml

Theoretical ranges:
  Revolute (base/elbow/wrist): explore 1000–2000 us, bounds 500–2500 us
  Prismatic:                    explore 1000–2000 us, bounds 500–2500 us
""",
    )
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--joint", type=int, required=True, choices=[0, 1, 2, 3])
    ap.add_argument("--step-us", type=int, default=25,
                    help="pulse step in microseconds (default 25)")
    ap.add_argument("--hold-ms", type=int, default=800,
                    help="pause per step in ms (default 800)")
    ap.add_argument("--skip-validation", action="store_true",
                    help="skip Phase 2 (validation) — use when time-critical")
    args = ap.parse_args()

    joint_type = JOINT_TYPES[args.joint]
    explore_min, explore_max, floor_us, ceil_us = _get_theoretical_range(args.joint)

    # Show context: what TOML has now vs what we'll explore
    print(f"Joint {args.joint} ({joint_type})")
    print(f"  TOML actual:      [{CFG['pulse_min'][args.joint]}, "
          f"{CFG['pulse_max'][args.joint]}] us  ← historico, NO se usa para explorar")
    print(f"  Rango teorico:    [{explore_min}, {explore_max}] us  ← limites de discovery")
    print(f"  Limites fisicos:  [{floor_us}, {ceil_us}] us  ← absoluto, jamas se excede")
    print(f"  Canal PCA9685:    {CFG['servo_channels'][args.joint]}")
    print()

    ser = _connect(args.port, args.baud)

    # ── Phase 1: Discovery ──
    disc_min, disc_max = _phase_discovery(
        ser, CFG["servo_channels"][args.joint], args.step_us,
        explore_min, explore_max,
    )

    print(f"\n  Rango descubierto: [{disc_min}, {disc_max}] us "
          f"(ancho: {disc_max - disc_min} us)")

    # ── Phase 2: Validation (optional) ──
    if not args.skip_validation:
        val_min, val_max = _phase_validation(
            ser, CFG["servo_channels"][args.joint],
            disc_min, disc_max, args.step_us,
        )
    else:
        val_min, val_max = disc_min, disc_max
        print("\n  [SKIP] Fase 2 (validacion) omitida por --skip-validation")

    # ── Phase 3: Write ──
    print(f"\n── FASE 3: ESCRITURA ──")
    print(f"  Rango final: [{val_min}, {val_max}] us (ancho: {val_max - val_min} us)")
    print(f"  TOML actual: [{CFG['pulse_min'][args.joint]}, "
          f"{CFG['pulse_max'][args.joint]}] us")

    confirm = input("\n  Escribir en safety-envelope.toml? [y/N] ").strip().lower()
    if confirm != "y":
        print("  Cancelado — no se escribio nada")
        ser.close()
        return

    write_pulse_range(args.joint, val_min, val_max)
    ser.close()


if __name__ == "__main__":
    main()
