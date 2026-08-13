#!/usr/bin/env python3
"""Thalos firmware — find the SAFE mechanical limits of a mounted joint.

Designed for servos that CANNOT be decoupled from the mechanism. It does NOT
measure the servo's internal end stop (that would require stalling it, which
damages the gearbox under load). Instead it walks the joint in SMALL
increments, one step at a time, and stops at the first sign of stall /
collision / resistance — the safe working limit of the MECHANISM.

Recommended procedure (do BOTH phases):
  Phase 1 (manual): with the servo unpowered/unpulsed (it free-wheels through
    its gearbox), move the joint BY HAND to its real mechanical ends and note
    them. This maps the physical range with zero electrical risk.
  Phase 2 (this script): verify with tiny steps and stop at the first stall.

Safety rules:
  - Keep a hand ON THE ARM to FEEL the stall before you hear it.
  - Small steps, long pauses, one confirmation per step.
  - On the first sign of stall (buzzing, vibration, resistance, heat):
    answer 'n' — that direction is done.
  - NEVER leave the servo stalling for more than a couple of seconds.
  - First waypoint may jump to 0 rad (neutral) — hold the arm.

After measuring, the tool writes the measured joint limits BACK to the
canonical ``config/safety-envelope.toml`` (single source of truth — spec
safety-envelope-canonical-source) via ``safety_config`` — one field at a
time, old/new shown first (7-step flow, see docs/calibration.md) — then
prints the regeneration and parity commands. ``write_joint_limits`` is a
pure function (no serial / no hardware) so it is unit-testable
independently.

Usage:
    python3 firmware/esp32/tools/limit_finder.py --joint 1 --step 0.02 --hold-ms 1500
"""
import argparse
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "tools"))
import safety_config  # noqa: E402


def write_joint_limits(channel_index, min_rad, max_rad, toml_path=None):
    """Write the measured safe joint limits for ONE channel back to the TOML.

    Pure (no serial / no hardware): the candidate values are injected, so CI
    can exercise the write-back without a robot. Shows old/new for each field
    (flow step 3), writes ONLY the two calibration fields of that channel
    (flow step 4), then prints the regeneration + parity commands (steps
    6-7). A warning is emitted if the envelope now exceeds the calibration
    range (spec R10).
    """
    path = toml_path or safety_config.DEFAULT_TOML
    old_min = safety_config.get_field(channel_index, "calibration", "joint_min_rad", path)
    old_max = safety_config.get_field(channel_index, "calibration", "joint_max_rad", path)
    safety_config.show_old_new(channel_index, "calibration", "joint_min_rad", old_min, min_rad)
    safety_config.update_channel_field(
        channel_index, "calibration", "joint_min_rad", min_rad, toml_path=path
    )
    safety_config.show_old_new(channel_index, "calibration", "joint_max_rad", old_max, max_rad)
    safety_config.update_channel_field(
        channel_index, "calibration", "joint_max_rad", max_rad, toml_path=path
    )
    print("  Escrito en config/safety-envelope.toml. Proximos pasos:")
    print("    python3 tools/generate_safety_config.py")
    print("    python3 tools/check_safety_parity.py")


def main():
    import serial
    import time

    ap = argparse.ArgumentParser(description="Thalos safe joint limit finder")
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--joint", type=int, required=True, choices=[0, 1, 2, 3])
    ap.add_argument("--step", type=float, default=0.02,
                    help="increment per step in radians (default 0.02)")
    ap.add_argument("--hold-ms", type=int, default=1500,
                    help="pause per step in ms (default 1500)")
    ap.add_argument("--max", type=float, default=1.0,
                    help="hard stop of the sweep in radians from 0 (default 1.0)")
    args = ap.parse_args()

    print("LIMITE SEGURO del mecanismo (servo MONTADO, no desacoplar).")
    print("Mano en el brazo. Pasos de", args.step, "rad cada", args.hold_ms, "ms.")
    print("  y = sigue libre | n = stall/colision/resistencia (PARA esta direccion)")
    print("  Ctrl+C = abortar todo (queda en hold)")
    print("El primer waypoint puede saltar al neutro (0 rad). SOSTEN EL BRAZO.")
    input("Enter para comenzar...")

    ser = serial.Serial(args.port, args.baud, timeout=3)

    def read_line():
        return ser.readline().decode("utf-8", "replace").strip()

    def cmd(line, expect):
        ser.write((line + "\n").encode())
        resp = read_line()
        if expect not in resp:
            print(f"[ERR] {resp!r}")
            return False
        return True

    def go_to(rad):
        vals = [0.0, 0.0, 0.0, 0.0]
        vals[args.joint] = round(rad, 4)
        if not cmd("HELLO 1", "OK"):
            return False
        if not cmd("MANIFEST 4 1 1", "OK"):
            return False
        if not cmd("SEGMENT 0 movej 0 1", "OK"):
            return False
        ser.write(f"SAMPLE {vals[0]:.4f} {vals[1]:.4f} {vals[2]:.4f} {vals[3]:.4f} 0\n".encode())
        read_line()
        if not cmd("END_UPLOAD", "READY"):
            return False
        if not cmd("EXECUTE", "OK"):
            return False
        time.sleep(args.hold_ms / 1000.0)
        print(f"    posicion {rad:+.4f} rad")
        return True

    def confirm_limit(pos, step, direction):
        """Verifica objetivamente un posible tope con la prueba de reversa:
        retrocede un paso (debe moverse) y re-avanza (no debe moverse si es
        tope real). Firma del tope: avanza no, retrocede si."""
        print("    ? posible tope detectado — verificando con reversa...")
        back = round(pos - step * direction, 4)
        go_to(back)
        ans_back = input("    - al retroceder, se movio hacia atras? [y/n/q] ").strip().lower()
        if ans_back == "q":
            return None, "q"
        if ans_back == "n":
            print("    (el brazo no retrocedio — no parece tope, seguimos)")
            return False, None
        go_to(pos)
        ans_fwd = input("    - al re-avanzar, se movio hacia adelante? [y/n/q] ").strip().lower()
        if ans_fwd == "q":
            return None, "q"
        if ans_fwd == "n":
            print("    -> TOPE CONFIRMADO (avanza no, retrocede si)")
            return True, None
        print("    (el brazo volvio a avanzar — era friccion, seguimos)")
        return False, None

    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(1.2)
    ser.reset_input_buffer()

    # Ir al neutro primero (con precaucion).
    go_to(0.0)

    # Barrido hacia positivo.
    pos = 0.0
    pos_ok = [0.0]
    while pos < args.max:
        pos = round(pos + args.step, 4)
        go_to(pos)
        ans = input("    zumba o se detuvo? [y=sigue/n=stall/q] ").strip().lower()
        if ans == "q":
            ser.close()
            sys.exit(0)
        if ans == "n":
            confirmed, q = confirm_limit(pos, args.step, +1)
            if q:
                ser.close()
                sys.exit(0)
            if confirmed:
                pos_ok.append(round(pos - args.step, 4))
                break
            # No era tope: seguimos desde donde estamos.
        pos_ok.append(pos)

    # Volver al neutro.
    go_to(0.0)

    # Barrido hacia negativo.
    pos = 0.0
    neg_ok = [0.0]
    while pos > -args.max:
        pos = round(pos - args.step, 4)
        go_to(pos)
        ans = input("    zumba o se detuvo? [y=sigue/n=stall/q] ").strip().lower()
        if ans == "q":
            ser.close()
            sys.exit(0)
        if ans == "n":
            confirmed, q = confirm_limit(pos, args.step, -1)
            if q:
                ser.close()
                sys.exit(0)
            if confirmed:
                neg_ok.append(round(pos + args.step, 4))
                break
            # No era tope: seguimos desde donde estamos.
        neg_ok.append(pos)

    # Volver al neutro (seguro para dejar el brazo).
    go_to(0.0)

    print(f"\n=== LIMITES SEGUROS joint {args.joint} ===")
    print(f"  JOINT_MIN_RAD = {min(neg_ok)}")
    print(f"  JOINT_MAX_RAD = {max(pos_ok)}")
    write_joint_limits(args.joint, min(neg_ok), max(pos_ok))
    ser.close()


if __name__ == "__main__":
    main()
