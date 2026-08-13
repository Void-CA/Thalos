#!/usr/bin/env python3
"""Generate the safety-envelope derived artifacts from the canonical TOML.

Reads ``config/safety-envelope.toml`` (the SINGLE source of truth, spec
safety-envelope-canonical-source) and emits the two committed derived files:

  - firmware/esp32/src/servo_safety.h                  (C++, f32 literals)
  - backend/crates/thalos-runtime/src/execution_boundary/
      safety_envelope_generated.rs                     (Rust, f64 literals)

Determinism (ADR-1): channels are emitted in index order, floats use fixed
precision that round-trips through f32/f64 (never a raw ``repr`` that could
emit an exponent for the C++ side), and no timestamps are written — the same
TOML produces byte-identical output across runs.

The C++ f32 literals are byte-identical to the former hand-authored values in
``firmware/esp32/src/servo_config.h`` (e.g. ``1.5708f``, ``0.06f``), so the
firmware tests' ``expected_steps()`` math is unchanged.

Usage: python3 tools/generate_safety_config.py
"""

from __future__ import annotations

import pathlib
import sys
import tomllib

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
TOML_PATH = REPO_ROOT / "config" / "safety-envelope.toml"
OUT_CXX = REPO_ROOT / "firmware" / "esp32" / "src" / "servo_safety.h"
OUT_RUST = (
    REPO_ROOT
    / "backend"
    / "crates"
    / "thalos-runtime"
    / "src"
    / "execution_boundary"
    / "safety_envelope_generated.rs"
)

DO_NOT_EDIT = (
    "// DO NOT EDIT \u2014 generated from config/safety-envelope.toml\n"
    "// Regenerate: python3 tools/generate_safety_config.py\n"
)

# Provenance enum text per target language (LimitSource mirrors).
_SOURCE_TO_CXX = {
    "URDF": "URDF",
    "Measured": "Measured",
    "Configured": "Configured",
    "Temporary": "Temporary",
}
_SOURCE_TO_RS = {
    "URDF": "Urdf",
    "Measured": "Measured",
    "Configured": "Configured",
    "Temporary": "Temporary",
}


def fmt_f32(value: float) -> str:
    """Fixed-decimal literal that round-trips through f32, matching the former
    hand-authored forms byte-for-byte (``1.5708``, ``0.06``, ``1.0``).

    9 decimals after the point is enough precision for f32 in the envelope's
    magnitude range; trailing zeros are stripped and at least one digit after
    the decimal point is kept, so ``0.06`` stays ``0.06`` (never ``0.0600``)
    and ``1.0`` stays ``1.0`` (never ``1``).
    """
    s = f"{value:.9f}".rstrip("0").rstrip(".")
    if "." not in s:
        s += ".0"
    return s


def fmt_f64(value: float) -> str:
    """Shortest decimal that round-trips the f64 (Python ``repr``) — the Rust
    literal, e.g. ``1.5708``, ``0.06``."""
    return repr(value)


def emit_cxx(meta: dict, channels: list[dict]) -> str:
    lines = [DO_NOT_EDIT]
    lines.append(
        f"// metadata: schema_version {meta['schema_version']}, "
        f"robot {meta['robot']}, dof_count {meta['dof_count']}"
    )
    lines.append("")
    lines.append("#ifndef THALOS_SERVO_SAFETY_H")
    lines.append("#define THALOS_SERVO_SAFETY_H")
    lines.append("")
    lines.append('#include "servo_hw_config.h"')
    lines.append("")
    lines.append(
        "// \u2500\u2500 Limit provenance \u2014 mirrors the firmware contract "
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
    )
    lines.append(
        "enum class LimitSource : uint8_t { URDF, Measured, Configured, Temporary };"
    )
    lines.append("")
    lines.append("struct SafetyEnvelope {")
    lines.append("    float position_min_rad, position_max_rad;")
    lines.append("    uint16_t pulse_min_us, pulse_max_us;")
    lines.append("    float max_velocity_rad_per_s;")
    lines.append("    LimitSource position_source, pulse_source, velocity_source;")
    lines.append("};")
    lines.append("")
    lines.append(
        "// \u2500\u2500 Joint Limits (rad) \u2014 CALIBRATION MAP ONLY (ADR-1 "
        "authority split) \u2500\u2500\u2500\u2500"
    )
    lines.append(
        "// Per-channel rad\u2192pulse linear-interpolation endpoints; NOT the "
        "execution enforcement authority."
    )
    lines.append("constexpr float JOINT_MIN_RAD[NUM_SERVO_CHANNELS] = {")
    lines.append("    " + ", ".join(f"{fmt_f32(c['calibration']['joint_min_rad'])}f" for c in channels) + ",")
    lines.append("};")
    lines.append("constexpr float JOINT_MAX_RAD[NUM_SERVO_CHANNELS] = {")
    lines.append("    " + ", ".join(f"{fmt_f32(c['calibration']['joint_max_rad'])}f" for c in channels) + ",")
    lines.append("};")
    lines.append("")
    lines.append(
        "// \u2500\u2500 Pulse Width Range (\u00b5s) \u2014 SERVO_PULSE_MIN/MAX_US "
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
    )
    lines.append("constexpr uint16_t SERVO_PULSE_MIN_US[NUM_SERVO_CHANNELS] = {")
    lines.append("    " + ", ".join(str(c["pulse"]["min_us"]) for c in channels) + ",")
    lines.append("};")
    lines.append("constexpr uint16_t SERVO_PULSE_MAX_US[NUM_SERVO_CHANNELS] = {")
    lines.append("    " + ", ".join(str(c["pulse"]["max_us"]) for c in channels) + ",")
    lines.append("};")
    lines.append("")
    lines.append(
        "// \u2500\u2500 SafetyEnvelope \u2014 EXECUTION ENFORCEMENT AUTHORITY "
        "(ADR-1) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
    )
    lines.append(
        "// What may PHYSICALLY execute. Every layer that can stop a command "
        "enforces this envelope."
    )
    lines.append("constexpr SafetyEnvelope SAFETY_ENVELOPE[NUM_SERVO_CHANNELS] = {")
    for c in channels:
        env = c["envelope"]
        pulse = c["pulse"]
        lines.append(f"    // {c['name']} ({c['index']})")
        lines.append(
            "    { "
            f"{fmt_f32(env['position_min_rad'])}f, {fmt_f32(env['position_max_rad'])}f, "
            f"SERVO_PULSE_MIN_US[{c['index']}], SERVO_PULSE_MAX_US[{c['index']}], "
            f"{fmt_f32(env['max_velocity_rad_per_s'])}f, "
            f"LimitSource::{_SOURCE_TO_CXX[env['position_source']]}, "
            f"LimitSource::{_SOURCE_TO_CXX[pulse['source']]}, "
            f"LimitSource::{_SOURCE_TO_CXX[env['velocity_source']]} "
            "},"
        )
    lines.append("};")
    lines.append("")
    lines.append("#endif // THALOS_SERVO_SAFETY_H")
    lines.append("")
    return "\n".join(lines)


def emit_rust(meta: dict, channels: list[dict]) -> str:
    lines = [DO_NOT_EDIT]
    lines.append(
        f"// metadata: schema_version {meta['schema_version']}, "
        f"robot {meta['robot']}, dof_count {meta['dof_count']}"
    )
    lines.append("")
    lines.append(f"pub const SAFETY_ENVELOPE: [ChannelEnvelope; {len(channels)}] = [")
    for c in channels:
        env = c["envelope"]
        pulse = c["pulse"]
        lines.append(f"    // {c['name']} ({c['index']})")
        lines.append("    ChannelEnvelope {")
        lines.append(
            "        position_min_rad: "
            f"{fmt_f64(env['position_min_rad'])}, "
            f"position_max_rad: {fmt_f64(env['position_max_rad'])},"
        )
        lines.append(
            f"        pulse_min_us: {pulse['min_us']}, pulse_max_us: {pulse['max_us']},"
        )
        lines.append(
            f"        max_velocity_rad_per_s: {fmt_f64(env['max_velocity_rad_per_s'])},"
        )
        lines.append(
            "        position_source: "
            f"LimitSource::{_SOURCE_TO_RS[env['position_source']]},"
        )
        lines.append(f"        pulse_source: LimitSource::{_SOURCE_TO_RS[pulse['source']]},")
        lines.append(
            "        velocity_source: "
            f"LimitSource::{_SOURCE_TO_RS[env['velocity_source']]},"
        )
        lines.append("    },")
    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    with TOML_PATH.open("rb") as f:
        data = tomllib.load(f)
    meta = data["metadata"]
    channels = sorted(data["channel"], key=lambda ch: ch["index"])

    # M1: emit only. TOML validation (11 rules) arrives in M2
    # (tools/check_safety_parity.py).
    OUT_CXX.write_text(emit_cxx(meta, channels), encoding="utf-8")
    OUT_RUST.write_text(emit_rust(meta, channels), encoding="utf-8")
    print(f"wrote {OUT_CXX.relative_to(REPO_ROOT)}")
    print(f"wrote {OUT_RUST.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
