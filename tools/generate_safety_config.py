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

Validation (ADR-2, spec "TOML Validation Before Generation"): before anything
is written, the TOML is checked against the 11 rules in :func:`validate_toml`
(schema version, dof count, range ordering, provenance enums, envelope within
calibration, hardware channels). Invalid TOML → exit 1 and NO files written.

Usage: python3 tools/generate_safety_config.py [--out-dir DIR]
``--out-dir`` writes both artifacts flat into DIR (used by the determinism
test; the committed locations are left untouched).
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

VALID_SOURCES = frozenset({"URDF", "Measured", "Configured", "Temporary"})
SUPPORTED_SCHEMA_VERSIONS = frozenset({1})
# PCA9685 has 16 outputs (0..15) — servo channel indices must fit.
MAX_SERVO_CHANNELS = 15


def validate_toml(data: dict) -> list[str]:
    """The 11 TOML validation rules (spec: "TOML Validation Before Generation").

    Returns a list of human-readable violations (``[]`` = valid). Called by the
    generator BEFORE emitting (invalid TOML → exit 1, nothing written) and by
    the parity gate (invalid TOML cannot be graded).

        R1   metadata.schema_version present
        R2   metadata.schema_version supported (== 1)
        R3   metadata.dof_count == len(channel)
        R4   envelope position_min_rad < position_max_rad (per channel)
        R5   pulse min_us < max_us (per channel)
        R6   envelope.max_velocity_rad_per_s >= 0 (per channel)
        R7   envelope.position_source ∈ {URDF, Measured, Configured, Temporary}
        R8   pulse.source ∈ {URDF, Measured, Configured, Temporary}
        R9   envelope.velocity_source ∈ {URDF, Measured, Configured, Temporary}
        R10  envelope position range ⊆ calibration joint range (per channel)
        R11  hardware: servo channel indices within 0..15, num_servo_channels
             matches len(servo_channels), channel indices contiguous 0-based
    """
    errors: list[str] = []
    meta = data.get("metadata", {})
    channels = data.get("channel", [])

    if "schema_version" not in meta:
        errors.append("R1 metadata.schema_version is missing")
    elif meta["schema_version"] not in SUPPORTED_SCHEMA_VERSIONS:
        errors.append(
            f"R2 unsupported metadata.schema_version={meta['schema_version']!r} "
            f"(supported: {sorted(SUPPORTED_SCHEMA_VERSIONS)})"
        )

    dof = meta.get("dof_count")
    if dof is None:
        errors.append("R3 metadata.dof_count is missing")
    elif dof != len(channels):
        errors.append(f"R3 metadata.dof_count={dof} != len(channel)={len(channels)}")

    for ch in channels:
        tag = f"channel[{ch.get('index', '?')}] {ch.get('name', '?')}".rstrip()
        env = ch.get("envelope", {})
        cal = ch.get("calibration", {})
        pulse = ch.get("pulse", {})

        pmin, pmax = env.get("position_min_rad"), env.get("position_max_rad")
        if pmin is not None and pmax is not None and not pmin < pmax:
            errors.append(
                f"R4 {tag}.envelope position range [{pmin}, {pmax}] must satisfy "
                "position_min_rad < position_max_rad"
            )

        mn, mx = pulse.get("min_us"), pulse.get("max_us")
        if mn is not None and mx is not None and not mn < mx:
            errors.append(
                f"R5 {tag}.pulse range [{mn}, {mx}] must satisfy min_us < max_us"
            )

        vel = env.get("max_velocity_rad_per_s")
        if vel is not None and vel < 0:
            errors.append(
                f"R6 {tag}.envelope.max_velocity_rad_per_s={vel} must be >= 0"
            )

        for rule, field, src in (
            ("R7", f"{tag}.envelope.position_source", env.get("position_source")),
            ("R8", f"{tag}.pulse.source", pulse.get("source")),
            ("R9", f"{tag}.envelope.velocity_source", env.get("velocity_source")),
        ):
            if src is not None and src not in VALID_SOURCES:
                errors.append(
                    f"{rule} {field}={src!r} not in {sorted(VALID_SOURCES)}"
                )

        if pmin is not None and pmax is not None:
            cmin, cmax = cal.get("joint_min_rad"), cal.get("joint_max_rad")
            if cmin is not None and cmax is not None and (pmin < cmin or pmax > cmax):
                errors.append(
                    f"R10 {tag}.envelope [{pmin}, {pmax}] exceeds calibration "
                    f"joint range [{cmin}, {cmax}]"
                )

    hw = data.get("hardware", {})
    servo_channels = hw.get("servo_channels", [])
    for idx in servo_channels:
        if not isinstance(idx, int) or not 0 <= idx <= MAX_SERVO_CHANNELS:
            errors.append(
                f"R11 hardware.servo_channels entry {idx!r} outside "
                f"0..{MAX_SERVO_CHANNELS}"
            )
    num = hw.get("num_servo_channels")
    if num is not None and num != len(servo_channels):
        errors.append(
            f"R11 hardware.num_servo_channels={num} != "
            f"len(servo_channels)={len(servo_channels)}"
        )
    indices = [ch.get("index") for ch in channels]
    if indices and sorted(indices) != list(range(len(channels))):
        errors.append(f"R11 channel indices {indices} are not contiguous 0-based")

    return errors


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


def _display(path: pathlib.Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        metavar="DIR",
        default=None,
        help="write both generated files flat into DIR instead of the "
        "committed locations (determinism test)",
    )
    args = parser.parse_args(argv)

    with TOML_PATH.open("rb") as f:
        data = tomllib.load(f)

    errors = validate_toml(data)
    if errors:
        for e in errors:
            print(f"{TOML_PATH.name}: invalid: {e}", file=sys.stderr)
        print("no files written", file=sys.stderr)
        return 1

    meta = data["metadata"]
    channels = sorted(data["channel"], key=lambda ch: ch["index"])

    if args.out_dir is not None:
        out_dir = pathlib.Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_cxx = out_dir / "servo_safety.h"
        out_rust = out_dir / "safety_envelope_generated.rs"
    else:
        out_cxx, out_rust = OUT_CXX, OUT_RUST

    out_cxx.write_text(emit_cxx(meta, channels), encoding="utf-8")
    out_rust.write_text(emit_rust(meta, channels), encoding="utf-8")
    print(f"wrote {_display(out_cxx)}")
    print(f"wrote {_display(out_rust)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
